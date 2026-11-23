<script lang="ts">
	import { store } from './lib/store.svelte';
	import Board from './lib/Board.svelte';
	import ItemEditor from './lib/ItemEditor.svelte';
	import SettingsModal from './lib/SettingsModal.svelte';

	let keyInput = $state('');
	let busy = $state(false);
	let keyField = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (store.needsKey) keyField?.focus();
	});

	$effect(() => {
		const saved = localStorage.getItem('kanban-key');
		if (saved) void store.init(saved);
		else store.needsKey = true;
	});

	async function submitKey(e: SubmitEvent) {
		e.preventDefault();
		if (!keyInput.trim() || busy) return;
		busy = true;
		const ok = await store.init(keyInput.trim());
		busy = false;
		if (ok) localStorage.setItem('kanban-key', keyInput.trim());
	}
</script>

{#if store.needsKey}
	<div class="key-gate">
		<form onsubmit={submitKey}>
			<h1>Kanban</h1>
			<p>Enter your API key to access this board.</p>
			<input type="password" placeholder="API key" bind:value={keyInput} bind:this={keyField} />
			<button type="submit" disabled={busy}>{busy ? '…' : 'Open board'}</button>
			{#if store.loadError}<p class="error">{store.loadError}</p>{/if}
		</form>
	</div>
{:else if store.loadError}
	<div class="loading error">{store.loadError}</div>
{:else if store.state.columns.length > 0 || store.connected}
	<div class="app-header">
		<span class="app-title">Kanban</span>
		<span class="conn {store.connected ? 'on' : 'off'}" title={store.connected ? 'live' : 'reconnecting…'}></span>
		<button
			class="icon-btn settings-btn"
			title="Settings"
			aria-label="Settings"
			onclick={() => (store.settingsOpen = true)}
			>⚙</button
		>
	</div>
	<Board />
	<ItemEditor />
	<SettingsModal />
{:else}
	<div class="loading">Loading…</div>
{/if}
