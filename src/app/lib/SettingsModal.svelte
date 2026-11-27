<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { store } from './store.svelte';
	import { pop, reducedMotion } from './motion';

	interface ColumnDraft {
		id: string;
		name: string;
		dateGrouped: boolean;
	}
	interface ColorDraft {
		id: string;
		name: string;
		hex: string;
	}

	let columnDrafts = $state<ColumnDraft[]>([]);
	let colorDrafts = $state<ColorDraft[]>([]);
	let newColumnName = $state('');
	let newColorName = $state('');
	let newColorHex = $state('#888888');

	function removeColumn(d: ColumnDraft) {
		if (!confirm(`Delete column "${d.name}" and all of its items?`)) return;
		store.send({ type: 'column.delete', id: d.id });
		columnDrafts = columnDrafts.filter((x) => x.id !== d.id);
	}

	// snapshot drafts only when the editor opens — live state changes (e.g. the
	// optimistic apply + broadcast of our own add) must not reset in-progress edits
	$effect(() => {
		if (store.settingsOpen) {
			untrack(() => {
				columnDrafts = store
					.columns()
					.map((c) => ({ id: c.id, name: c.title, dateGrouped: c.dateGrouped }));
				colorDrafts = store.state.colors.map((c) => ({ id: c.id, name: c.name, hex: c.hex }));
				newColumnName = '';
				newColorName = '';
			});
		}
	});

	async function addColumn() {
		const title = newColumnName.trim();
		if (!title) return;
		const before = new Set(store.state.columns.map((c) => c.id));
		try {
			await store.sendAsync({ type: 'column.create', title });
		} catch {
			return;
		}
	const created = untrack(() => store.state.columns.find((c) => !before.has(c.id)));
	if (created)
		columnDrafts = [
			...columnDrafts,
			{ id: created.id, name: created.title, dateGrouped: created.dateGrouped }
		];
		newColumnName = '';
	}

	async function addColor() {
		const name = newColorName.trim();
		if (!name) return;
		const before = new Set(store.state.colors.map((c) => c.id));
		try {
			await store.sendAsync({ type: 'color.create', name, hex: newColorHex.toLowerCase() });
		} catch {
			return;
		}
	const created = untrack(() => store.state.colors.find((c) => !before.has(c.id)));
	if (created) colorDrafts = [...colorDrafts, { ...created }];
		newColorName = '';
	}

	function save() {
		for (const d of columnDrafts) {
			const original = store.state.columns.find((c) => c.id === d.id);
			const name = d.name.trim();
			if (!original) continue;
			if (name && name !== original.title) {
				store.send({ type: 'column.rename', id: d.id, title: name });
			}
			if (d.dateGrouped !== original.dateGrouped) {
				store.send({ type: 'column.setDateGrouped', id: d.id, value: d.dateGrouped });
			}
		}
		for (const d of colorDrafts) {
			const original = store.state.colors.find((c) => c.id === d.id);
			if (!original) continue;
			const name = d.name.trim();
			const patch: { type: 'color.update'; id: string; name?: string; hex?: string } = {
				type: 'color.update',
				id: d.id
			};
			if (name && name !== original.name) patch.name = name;
			if (d.hex.toLowerCase() !== original.hex) patch.hex = d.hex.toLowerCase();
			if (Object.keys(patch).length > 2) store.send(patch);
		}
		store.settingsOpen = false;
	}

	function discard() {
		store.settingsOpen = false;
	}
</script>

<svelte:window onkeydown={(e) => store.settingsOpen && e.key === 'Escape' && discard()} />

{#if store.settingsOpen}
	<div
		class="overlay"
		role="presentation"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onclick={(e) => e.target === e.currentTarget && save()}
	>
		<div
			class="editor settings-editor"
			role="dialog"
			aria-label="Board settings"
			transition:pop
		>
			<div class="settings-columns">
				<section class="settings-col">
					<h3 class="palette-title">Columns</h3>
					{#each columnDrafts as d, i (d.id)}
						<div class="palette-row">
							<input
								type="text"
								bind:value={columnDrafts[i]!.name}
								maxlength="100"
								aria-label="Column name"
							/>
							<label class="date-toggle" title="Group items by the day they land in this column">
								<input type="checkbox" bind:checked={columnDrafts[i]!.dateGrouped} />
								by date
							</label>
							<button
								class="icon-btn danger"
								title="Delete column"
								aria-label={`Delete column ${d.name}`}
								onclick={() => removeColumn(d)}
							>×</button>
						</div>
					{/each}
					<div class="settings-add">
						<input
							type="text"
							placeholder="New column name…"
							bind:value={newColumnName}
							maxlength="100"
							aria-label="New column name"
							onkeydown={(e) => e.key === 'Enter' && addColumn()}
						/>
						<button class="btn ghost" onclick={addColumn} disabled={!newColumnName.trim()}>
							Add column
						</button>
					</div>
				</section>

				<section class="settings-col">
					<h3 class="palette-title">Colors</h3>
					{#each colorDrafts as d, i (d.id)}
						<div class="palette-row">
							<input
								type="color"
								bind:value={colorDrafts[i]!.hex}
								aria-label={`Color for ${d.name}`}
							/>
							<input
								type="text"
								bind:value={colorDrafts[i]!.name}
								maxlength="50"
								aria-label="Color name"
							/>
						</div>
					{/each}
					<div class="palette-row settings-add">
						<input type="color" bind:value={newColorHex} aria-label="New color" />
						<input
							type="text"
							placeholder="New color name…"
							bind:value={newColorName}
							maxlength="50"
							aria-label="New color name"
							onkeydown={(e) => e.key === 'Enter' && addColor()}
						/>
						<button class="btn ghost" onclick={addColor} disabled={!newColorName.trim()}>
							Add color
						</button>
					</div>

					<h3 class="palette-title">Default color for new items</h3>
					<div class="palette-row">
						<span class="swatches" role="listbox" aria-label="Default item color">
							<button
								type="button"
								class="swatch swatch-none"
								class:selected={store.defaultColor === 'none'}
								title="No color"
								aria-label="No color"
								onclick={() => store.setDefaultColor('none')}
							></button>
							{#each store.state.colors as c (c.id)}
								<button
									type="button"
									class="swatch"
									class:selected={store.defaultColor === c.id}
									style={`background: ${c.hex}`}
									title={c.name}
									aria-label={c.name}
									onclick={() => store.setDefaultColor(c.id)}
								></button>
							{/each}
						</span>
					</div>
				</section>
			</div>

			<div class="editor-actions">
				<span class="spacer"></span>
				<button class="btn ghost" onclick={discard}>Cancel</button>
				<button class="btn" onclick={save}>Save</button>
			</div>
		</div>
	</div>
{/if}
