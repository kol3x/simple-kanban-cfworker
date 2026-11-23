<script lang="ts">
	import { fade } from 'svelte/transition';
	import { type Color } from '../../shared/types';
	import { store } from './store.svelte';
	import { pop, reducedMotion } from './motion';

	let item = $derived(store.editingId ? store.item(store.editingId) : undefined);
	let creating = $derived(store.creatingIn !== null);

	let title = $state('');
	let description = $state('');
	let deadline = $state('');
	let color = $state<Color>('none');
	let lastId = $state<string | null>(null);
	let titleField = $state<HTMLTextAreaElement | null>(null);
	let titleEditing = $state(false);
	let descEditing = $state(false);
	let descField = $state<HTMLTextAreaElement | null>(null);
	let confirmSave = $state(false);
	let confirmSaveBtn = $state<HTMLButtonElement | null>(null);

	// focus the dialog's primary action when it opens
	$effect(() => {
		if (confirmSave) queueMicrotask(() => confirmSaveBtn?.focus());
	});

	function confirmChoice(choice: 'save' | 'discard' | 'cancel'): void {
		confirmSave = false;
		if (choice === 'save') save();
		else if (choice === 'discard') discard();
		// 'cancel' just keeps editing
	}

	/** grow the title textarea so the whole value stays visible, however long */
	function growTitle(el: HTMLTextAreaElement | null): void {
		if (!el) return;
		el.style.height = 'auto';
		el.style.height = `${el.scrollHeight}px`;
	}

	const onTitleKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Enter' || e.shiftKey) return;
		// a title is one line — Enter applies the edit, but only creation closes the dialog
		e.preventDefault();
		if (!title.trim()) return;
		if (creating) {
			save();
		} else {
			persist();
			titleEditing = false;
		}
	};

	const onDescKeydown = (e: KeyboardEvent) => {
		// Shift+Enter writes a newline; plain Enter applies the edit
		if (e.key !== 'Enter') return;
		if (e.shiftKey) return;
		e.preventDefault();
		if (creating) {
			save();
		} else {
			persist();
			descEditing = false;
		}
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
			titleEditing = true;
			descEditing = true;
			queueMicrotask(() => {
				titleField?.focus();
				growTitle(titleField);
			});
		} else if (item && item.id !== lastId) {
			title = item.title;
			description = item.description;
			deadline = item.deadline ?? '';
			color = item.color;
			lastId = item.id;
			titleEditing = false;
			descEditing = false;
		}
	});

	/** true when nothing in the draft differs from what is on the board */
	function pristine(): boolean {
		if (creating) {
			return (
				!title.trim() &&
				!description &&
				deadline === '' &&
				color ===
					(store.defaultColor !== 'none' && store.colorHex(store.defaultColor) ? store.defaultColor : 'none')
			);
		}
		if (!item) return true;
		return (
			title === item.title &&
			description === item.description &&
			deadline === (item.deadline ?? '') &&
			color === item.color
		);
	}

	/** send unsaved draft changes to the board without closing the dialog */
	function persist() {
		if (creating) {
			save();
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
	}

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
		persist();
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
		if (!item && !creating) return;
		if (e.key !== 'Escape') return;
		if (confirmSave) {
			// second Esc while asking = keep editing
			confirmSave = false;
		} else if (pristine()) {
			discard();
		} else {
			confirmSave = true;
		}
	};

	function startTitleEdit(): void {
		titleEditing = true;
		queueMicrotask(() => {
			growTitle(titleField);
			titleField?.focus();
		});
	}

	function onTitleBlur(): void {
		// a task needs a title — don't let the draft become empty while editing
		if (!creating && !title.trim()) title = store.item(item?.id ?? '')?.title ?? title;
		titleEditing = false;
	}

	function startDescEdit(): void {
		descEditing = true;
		queueMicrotask(() => descField?.focus());
	}
</script>

<svelte:window onkeydown={onOverlayKeydown} />

{#if item || creating}
	<div
		class="overlay"
		role="presentation"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onclick={(e) => e.target === e.currentTarget && save()}
	>
		<div
			class="editor"
			role="dialog"
			aria-label={creating ? 'New item' : 'Edit item'}
			transition:pop
		>
			<label>
				Title
				{#if creating || titleEditing}
					<textarea
						bind:this={titleField}
						bind:value={title}
						maxlength="2000"
						rows="1"
						class="title-input"
						oninput={(e) => growTitle(e.currentTarget)}
						onkeydown={onTitleKeydown}
						onblur={onTitleBlur}
					></textarea>
				{:else}
					<div
						class="static-field title-view"
						role="button"
						tabindex="0"
						aria-label="Edit title"
						onclick={startTitleEdit}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && startTitleEdit()}
					>
						{title || ' '}
					</div>
				{/if}
			</label>
			<label>
				Description
				{#if creating || descEditing}
					<textarea
						bind:this={descField}
						rows="6"
						bind:value={description}
						maxlength="10000"
						onkeydown={onDescKeydown}
						onblur={() => (descEditing = false)}
					></textarea>
				{:else}
					<div
						class="static-field desc-view"
						class:placeholder={!description}
						role="button"
						tabindex="0"
						aria-label="Edit description"
						onclick={startDescEdit}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && startDescEdit()}
					>
						{description || 'Add a description…'}
					</div>
				{/if}
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

{#if confirmSave}
	<div
		class="overlay confirm-overlay"
		role="presentation"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onclick={(e) => e.target === e.currentTarget && (confirmSave = false)}
	>
		<div
			class="confirm-box"
			role="alertdialog"
			aria-label="Unsaved changes"
			transition:pop={{ start: 0.94 }}
		>
			<button
				class="icon-btn confirm-close"
				title="Close"
				aria-label="Close without saving"
				onclick={() => confirmChoice('cancel')}
			>×</button>
			<p>You have unsaved changes.</p>
			<div class="editor-actions">
				<span class="spacer"></span>
				<button class="btn danger" onclick={() => confirmChoice('discard')}>Discard</button>
				<button class="btn" bind:this={confirmSaveBtn} onclick={() => confirmChoice('save')}>
					Save
				</button>
			</div>
		</div>
	</div>
{/if}
