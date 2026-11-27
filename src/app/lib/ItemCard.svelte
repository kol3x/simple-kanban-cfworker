<script lang="ts">
	import type { ItemState } from '../../shared/types';
	import { store } from './store.svelte';

	let { item }: { item: ItemState } = $props();

	let overdue = $derived(
		item.deadline !== null && item.deadline < new Date().toISOString().slice(0, 10)
	);
	let hex = $derived(store.colorHex(item.color));

	let menu = $state<{ x: number; y: number } | null>(null);

	function onContextMenu(e: MouseEvent) {
		e.preventDefault();
		// keep the menu inside the viewport
		menu = { x: Math.min(e.clientX, innerWidth - 190), y: Math.min(e.clientY, innerHeight - 90) };
	}

	function deleteItem() {
		menu = null;
		store.send({ type: 'item.delete', id: item.id });
	}

	function onDragStart(e: DragEvent) {
		store.dragging = item.id;
		e.dataTransfer?.setData('text/plain', item.id);
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			// suppress the native drag ghost that follows the cursor — the live
			// preview card in the list is the only feedback we want
			const ghost = document.createElement('div');
			ghost.style.cssText = 'position:fixed;top:-1000px;left:-1000px;width:1px;height:1px;';
			document.body.appendChild(ghost);
			e.dataTransfer.setDragImage(ghost, 0, 0);
			setTimeout(() => ghost.remove());
		}
	}

	function onDragEnd() {
		store.dragging = null;
		store.dropTarget = null;
	}
</script>

<div
	class="item-card"
	style={hex ? `--item-color: ${hex}` : undefined}
	class:dragging={store.dragging === item.id}
	class:fresh={store.freshIds.has(item.id)}
	data-id={item.id}
	draggable="true"
	ondragstart={onDragStart}
	ondragend={onDragEnd}
	oncontextmenu={onContextMenu}
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

{#if menu}
	<!-- fixed overlay catches outside clicks / right-clicks to dismiss the menu -->
	<div
		class="ctx-overlay"
		role="presentation"
		onclick={() => (menu = null)}
		oncontextmenu={(e) => {
			e.preventDefault();
			menu = null;
		}}
		onkeydown={(e) => e.key === 'Escape' && (menu = null)}
	>
		<div class="ctx-menu" role="menu" style={`left: ${menu.x}px; top: ${menu.y}px`}>
			<button
				class="menu-item ctx-danger"
				role="menuitem"
				onclick={deleteItem}
			>
				Delete
			</button>
		</div>
	</div>
{/if}
