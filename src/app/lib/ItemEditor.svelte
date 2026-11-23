<script lang="ts">
	import { type Color } from '../../shared/types';
	import { store } from './store.svelte';

	let item = $derived(store.editingId ? store.item(store.editingId) : undefined);
	let creating = $derived(store.creatingIn !== null);

	let title = $state('');
	let description = $state('');
	let deadline = $state('');
	let color = $state<Color>('none');
	let lastId = $state<string | null>(null);
	let titleField = $state<HTMLTextAreaElement | null>(null);

	/** grow the title textarea so the whole value stays visible, however long */
	function growTitle(el: HTMLTextAreaElement | null): void {
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	}

	const onTitleKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.shiftKey) return;
		// a title is one line — Enter creates the task (when there is one to create)
		e.preventDefault();
		if (creating && title.trim()) save();
	};

	// sync draft when a different item is opened or creation starts
	$effect(() => {
		if (creating) {
			title = '';
			description = '';
			deadline = '';
			// pre-select the user's default color; fall back if it was removed from the palette
			color = store.defaultColor !== 'none' && store.colorHex(store.defaultColor) ? store.defaultColor : 'none';
			lastId = null;
			titleField?.focus();
			growTitle(titleField);
		} else if (item && item.id !== lastId) {
			title = item.title;
			description = item.description;
			deadline = item.deadline ?? '';
			color = item.color;
			lastId = item.id;
			// let the title field settle at its full height before growing it
			queueMicrotask(() => growTitle(titleField));
		}
	});

	function save() {
		if (creating) {
			const columnId = store.creatingIn;
			const t = title.trim();
			if (!columnId || !t) return;
			const op: {
				type: 'item.create';
				columnId: string;
				title: string;
				index?: number;
				description?: string;
				deadline?: string | null;
				color?: Color;
			} = { type: 'item.create', columnId, title: t, index: 0 };
			if (description) op.description = description;
			if (deadline !== '') op.deadline = deadline;
			if (color !== 'none') op.color = color;
			store.send(op);
			store.creatingIn = null;
			return;
		}
		if (!item) return;
		const upd: {
			type: 'item.update';
			id: string;
			title?: string;
			description?: string;
			deadline?: string | null;
			color?: Color;
		} = { type: 'item.update', id: item.id };
		if (title.trim() && title !== item.title) upd.title = title.trim();
		if (description !== item.description) upd.description = description;
		const dl = deadline === '' ? null : deadline;
		if (dl !== item.deadline) upd.deadline = dl;
		if (color !== item.color) upd.color = color;
		if (Object.keys(upd).length > 2) store.send(upd);
		store.editingId = null;
	}

	function remove() {
		if (!item) return;
		store.send({ type: 'item.delete', id: item.id });
		store.editingId = null;
	}

	function discard() {
		store.editingId = null;
		store.creatingIn = null;
	}

	const onOverlayKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') discard();
	};
</script>

{#if item || creating}
	<div
		class="overlay"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && save()}
		onkeydown={onOverlayKeydown}
	>
		<div class="editor" role="dialog" aria-label={creating ? 'New item' : 'Edit item'}>
			<label>
				Title
				<textarea
					bind:this={titleField}
					bind:value={title}
					maxlength="2000"
					rows="1"
					class="title-input"
					oninput={(e) => growTitle(e.currentTarget)}
					onkeydown={onTitleKeydown}
				></textarea>
			</label>
			<label>
				Description
				<textarea rows="6" bind:value={description} maxlength="10000"></textarea>
			</label>
			<div class="row">
				<label>
					Deadline
					<input type="date" bind:value={deadline} />
				</label>
				<label>
					Color
					<span class="swatches" role="listbox" aria-label="Color">
						<button
							type="button"
							class="swatch swatch-none"
							class:selected={color === 'none'}
							title="No color"
							aria-label="No color"
							onclick={() => (color = 'none' satisfies Color)}
						></button>
						{#each store.state.colors as c (c.id)}
							<button
								type="button"
								class="swatch"
								class:selected={color === c.id}
								style={`background: ${c.hex}`}
								title={c.name}
								aria-label={c.name}
								onclick={() => (color = c.id)}
							></button>
						{/each}
					</span>
				</label>
			</div>
			<div class="editor-actions">
				{#if !creating}
					<button class="btn danger" onclick={remove}>Delete</button>
				{/if}
				<span class="spacer"></span>
				<button class="btn ghost" onclick={discard}>Cancel</button>
				<button class="btn" onclick={save} disabled={creating && !title.trim()}>
					{creating ? 'Create' : 'Save'}
				</button>
			</div>
		</div>
	</div>
{/if}
