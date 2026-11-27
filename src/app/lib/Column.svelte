<script lang="ts">
	import { flip } from 'svelte/animate';
	import type { ColumnState, ItemState } from '../../shared/types';
	import { store } from './store.svelte';
	import ItemCard from './ItemCard.svelte';

	let { column }: { column: ColumnState } = $props();

	// display order: for date-grouped columns this is day-sorted (oldest first)
	let items = $derived(store.displayItems(column.id));
	let listEl = $state<HTMLElement | null>(null);

	const PAGE = 20;
	/** how many items of the column are currently rendered (grows via Show more) */
	let shown = $state(PAGE);

	/**
	 * Live reorder preview: while a card is dragged over this column, show the
	 * list as it would look after the drop (dragged card removed from its slot,
	 * re-inserted at the hovered index, slightly dimmed). The drop then commits
	 * exactly that index, so nothing shifts on release.
	 */
	let previewItems = $derived.by(() => {
		const dt = store.dropTarget;
		const drag = store.dragging;
		if (!dt || dt.columnId !== column.id || !drag) return items;
		const dragged = items.find((i) => i.id === drag) ?? store.item(drag);
		if (!dragged) return items;
		const without = items.filter((i) => i.id !== drag);
		if (!column.dateGrouped) {
			const index = Math.max(0, Math.min(dt.index, without.length));
			return [...without.slice(0, index), dragged, ...without.slice(index)];
		}
		// the card adopts the day of the group it is dropped into — same rule as
		// item.move: the card above the insertion point wins; at the very top
		// (or in an empty column) it starts a fresh Today group
		const gi = Math.min(Math.max(dt.index, 0), without.length);
		const today = new Date().toISOString().slice(0, 10);
		const date = without[gi - 1]?.doneDate ?? today;
		// preview the card under its future day's header
		const ghost = dragged.doneDate === date ? dragged : { ...dragged, doneDate: date };
		return [...without.slice(0, gi), ghost, ...without.slice(gi)];
	});

	/** card lives here but is being dragged to another column → hide its slot
		(kept in the DOM so the browser still fires dragend on it) */
	let dragAwayId = $derived(
		store.dragging && store.dropTarget && store.dropTarget.columnId !== column.id
			? store.dragging
			: null
	);

	let visibleItems = $derived(previewItems.slice(0, shown));

	/** for date-grouped columns: consecutive runs of same-day cards with headers */
	let groups = $derived.by(() => {
		if (!column.dateGrouped) return null;
		const out: Array<{ date: string | null; label: string; items: ItemState[] }> = [];
		for (const item of visibleItems) {
			const date = item.doneDate;
			const last = out[out.length - 1];
			if (last && (last.date ?? null) === (date ?? null)) last.items.push(item);
			else out.push({ date, label: dateLabel(date), items: [item] });
		}
		return out;
	});

	function dateLabel(date: string | null): string {
		if (!date) return 'Undated';
		const now = new Date();
		if (date === now.toISOString().slice(0, 10)) return 'Today';
		if (date === new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)) return 'Yesterday';
		const d = new Date(`${date}T00:00:00Z`);
		const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
		if (d.getUTCFullYear() !== now.getUTCFullYear()) opts.year = 'numeric';
		return new Intl.DateTimeFormat('en-GB', opts).format(d);
	}

	// keep the fold-out consistent when items disappear or the column changes
	$effect(() => {
		if (shown > Math.max(items.length, PAGE)) shown = Math.max(items.length, PAGE);
	});

	/** index just past the Today group (Today is the first group). Casual drops
		— empty space under the list, the folded bar — land here, i.e. today. */
	function todayEnd(): number {
		const today = new Date().toISOString().slice(0, 10);
		let end = 0;
		for (const it of items) {
			if (it.id === store.dragging) continue;
			if ((it.doneDate ?? '') === today) end++;
			else break;
		}
		return end;
	}

	/** hover index = how many other cards' midpoints the pointer has passed */
	function hoverIndex(e: DragEvent): number {
		const drag = store.dragging;
		const cards = Array.from(listEl?.querySelectorAll<HTMLElement>('.item-card') ?? []);
		let index = 0;
		for (const card of cards) {
			if (!drag || card.dataset["id"] === drag) continue;
			const rect = card.getBoundingClientRect();
			if (e.clientY > rect.top + rect.height / 2) index++;
		}
		return index;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const id = store.dragging;
		const target = store.dropTarget;
		if (id && target && target.columnId === column.id) {
			store.send({ type: 'item.move', id, toColumnId: target.columnId, index: target.index });
		}
		store.dragging = null;
		store.dropTarget = null;
	}

	function handleDragOverList(e: DragEvent) {
		if (!store.dragging) return;
		e.preventDefault();
		e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
		// the empty space below the cards counts as "below the last card": the
		// preview sits right under it (no jump to the top of the column)
		store.dropTarget = { columnId: column.id, index: hoverIndex(e) };
	}

	// folded columns accept drops too — a drop lands in today's group
	function handleDragOverCollapsed(e: DragEvent) {
		if (!store.dragging) return;
		e.preventDefault();
		e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
		store.dropTarget = { columnId: column.id, index: todayEnd() };
	}
</script>

{#if column.collapsed}
	<button
		class="column-collapsed"
		class:drop-active={!!store.dragging && store.dropTarget?.columnId === column.id}
		title="Expand column"
		onclick={() => store.send({ type: 'column.toggleCollapse', id: column.id })}
		ondragover={handleDragOverCollapsed}
		ondrop={handleDrop}
	>
		<span class="count">{Math.min(items.length, 20)}</span>
		<span>{column.title}</span>
	</button>
{:else}
	<section
		class="column"
		role="group"
		aria-label={column.title}
		ondragover={handleDragOverList}
		ondrop={handleDrop}
	>
		<header class="column-header">
			<button
				class="column-title"
				title="Click to collapse"
				onclick={() => store.send({ type: 'column.toggleCollapse', id: column.id })}
			>
				{column.title}
			</button>
			<div class="column-actions">
				<button
					class="icon-btn add-item"
					title="Add item"
					aria-label="Add item"
					onclick={() => (store.creatingIn = column.id)}
				>+</button>
			</div>
		</header>

		<div class="column-list" bind:this={listEl}>
			{#if groups}
				{#each groups as g (g.date ?? 'undated')}
					<div class="date-group">
						<h4 class="date-label">{g.label}</h4>
						{#each g.items as item (item.id)}
							<div
								class="card-slot"
								class:drag-away={dragAwayId === item.id}
								animate:flip={{ duration: store.dragging ? 0 : 260 }}
							>
								<ItemCard {item} />
							</div>
						{/each}
					</div>
				{/each}
			{:else}
				{#each visibleItems as item (item.id)}
					<div
						class="card-slot"
						class:drag-away={dragAwayId === item.id}
						animate:flip={{ duration: store.dragging ? 0 : 260 }}
					>
						<ItemCard {item} />
					</div>
				{/each}
			{/if}
			{#if items.length > shown}
				<button class="btn ghost wide show-more" onclick={() => (shown += PAGE)}>
					Show more ({items.length - shown} hidden)
				</button>
			{/if}
		</div>

	</section>
{/if}
