<script lang="ts">
	import type { ItemState } from '../../shared/types';
	import { store } from './store.svelte';

	let { item }: { item: ItemState } = $props();

	let overdue = $derived(
		item.deadline !== null && item.deadline < new Date().toISOString().slice(0, 10)
	);
	let hex = $derived(store.colorHex(item.color));

	function onDragStart(e: DragEvent) {
		store.dragging = item.id;
		e.dataTransfer?.setData('text/plain', item.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
	}

	function onDragEnd() {
		store.dragging = null;
		store.dropTarget = null;
	}

	function onDragOver(e: DragEvent) {
		if (!store.dragging || store.dragging === item.id) return;
		e.preventDefault();
		e.stopPropagation();
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const index = e.clientY < rect.top + rect.height / 2 ? item.position : item.position + 1;
		store.dropTarget = { columnId: item.columnId, index };
	}
</script>

<div
	class="item-card"
	style={hex ? `--item-color: ${hex}` : undefined}
	class:dragging={store.dragging === item.id}
	draggable="true"
	ondragstart={onDragStart}
	ondragend={onDragEnd}
	ondragover={onDragOver}
	onclick={() => (store.editingId = item.id)}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (store.editingId = item.id)}
	tabindex="0"
	role="button"
>
	<p class="item-title">{item.title}</p>
	{#if item.description || item.deadline}
		<div class="item-icons">
			{#if item.description}
				<span class="chip" title="Has description">¶</span>
			{/if}
			{#if item.deadline}
				<span class="chip deadline" class:overdue title="Deadline">{item.deadline}</span>
			{/if}
		</div>
	{/if}
</div>
