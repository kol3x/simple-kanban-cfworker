<script lang="ts">
	import { fade } from 'svelte/transition';
	import { store } from './store.svelte';
	import { pop, reducedMotion } from './motion';

	function close() {
		store.reportOpen = false;
	}

	interface Segment {
		text: string;
		bold: boolean;
	}

	/** the only markdown the report supports: **bold**. Anything else renders as-is. */
	function renderBold(content: string): Segment[] {
		const parts: Segment[] = [];
		let i = 0;
		for (const m of content.matchAll(/\*\*(.+?)\*\*/gs)) {
			const idx = m.index!;
			if (idx > i) parts.push({ text: content.slice(i, idx), bold: false });
			parts.push({ text: m[1]!, bold: true });
			i = idx + m[0].length;
		}
		if (i < content.length) parts.push({ text: content.slice(i), bold: false });
		return parts;
	}
</script>

<svelte:window onkeydown={(e) => store.reportOpen && e.key === 'Escape' && close()} />

{#if store.reportOpen}
	<div
		class="overlay"
		role="presentation"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onclick={(e) => e.target === e.currentTarget && close()}
	>
		<div class="editor report-editor" role="dialog" aria-label="Daily report" transition:pop>
			{#if store.report}
				<div class="report-meta">Daily report · {store.report.day}</div>
				<div class="report-content">
					{#each renderBold(store.report.content) as seg}
						{#if seg.bold}<strong>{seg.text}</strong>{:else}{seg.text}{/if}
					{/each}
				</div>
			{:else}
				<div class="report-content report-empty">
					No report yet — the board generates one on weekdays at 07:00 UTC.
				</div>
			{/if}
			<div class="editor-actions">
				<span class="spacer"></span>
				<button class="btn ghost" onclick={close}>Close</button>
			</div>
		</div>
	</div>
{/if}
