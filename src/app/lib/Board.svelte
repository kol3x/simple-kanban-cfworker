<script lang="ts">
	import { store } from './store.svelte';
	import Column from './Column.svelte';

	let menu = $state<{ x: number; y: number } | null>(null);

	function onContextMenu(e: MouseEvent) {
		// cards have their own context menu — only handle right-clicks on the
		// board / column background
		if ((e.target as Element).closest('.item-card')) return;
		e.preventDefault();
		menu = { x: Math.min(e.clientX, innerWidth - 190), y: Math.min(e.clientY, innerHeight - 120) };
	}

	function openSettings() {
		menu = null;
		store.settingsOpen = true;
	}

	function openReport() {
		menu = null;
		store.reportOpen = true;
	}
</script>

<div class="board" oncontextmenu={onContextMenu}>
	{#each store.columns() as column (column.id)}
		<Column column={column} />
	{/each}
</div>

{#if menu}
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
			<div class="conn-status" title="connection status">
				<span class="conn {store.connected ? 'on' : 'off'}"></span>
				{store.connected ? 'Live' : 'Reconnecting…'}
			</div>
			<button class="menu-item" role="menuitem" onclick={openSettings}>Settings…</button>
			<button class="menu-item" role="menuitem" onclick={openReport}>Daily report…</button>
		</div>
	</div>
{/if}
