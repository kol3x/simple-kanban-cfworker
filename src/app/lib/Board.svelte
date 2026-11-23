<script lang="ts">
	import { store } from './store.svelte';
	import Column from './Column.svelte';
</script>

<div class="board">
	{#each store.columns() as column (column.id)}
		<Column column={column} />
	{/each}
</div>
