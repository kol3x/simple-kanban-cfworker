<script lang="ts">
	import type { ColumnState } from '../../shared/types';
	import { store } from './store.svelte';
	import ItemCard from './ItemCard.svelte';

	let { column }: { column: ColumnState } = $props();

	let items = $derived(store.itemsIn(column.id));
	let listEl = $state<HTMLElement | null>(null);

	const PAGE = 20;
	/** how many items of the column are currently rendered (grows via Show more) */
	let shown = $state(PAGE);
	let visibleItems = $derived(items.slice(0, shown));

	// keep the fold-out consistent when items disappear or the column changes
	$effect(() => {
		if (shown > Math.max(items.length, PAGE)) shown = Math.max(items.length, PAGE);
	});

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
		// index = after the last card the pointer is above
		const cards = Array.from(listEl?.querySelectorAll<HTMLElement>('.item-card') ?? []);
		let index = items.length;
		for (let i = 0; i < cards.length; i++) {
			const card = cards[i];
			if (!card) continue;
			const rect = card.getBoundingClientRect();
			if (e.clientY < rect.top + rect.height / 2) {
				index = i;
				break;
			}
		}
		store.dropTarget = { columnId: column.id, index };
	}
</script>

{#if column.collapsed}
	<button
		class="column-collapsed"
		title="Expand column"
		onclick={() => store.send({ type: 'column.toggleCollapse', id: column.id })}
	>
		<span>{column.title}</span>
		<span class="count">{items.length}</span>
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
			<span class="count">{items.length}</span>
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
			{#each visibleItems as item, i (item.id)}
				{#if store.dropTarget?.columnId === column.id && store.dropTarget.index === i && store.dragging && store.dragging !== item.id}
					<div class="drop-line"></div>
				{/if}
				<ItemCard {item} />
			{/each}
			{#if store.dropTarget?.columnId === column.id && store.dropTarget.index >= visibleItems.length && store.dropTarget.index < items.length && store.dragging}
				<div class="drop-line"></div>
			{/if}
		</div>

		{#if items.length > shown}
			<button class="btn ghost wide show-more" onclick={() => (shown += PAGE)}>
				Show more ({items.length - shown} hidden)
			</button>
		{/if}
	</section>
{/if}
