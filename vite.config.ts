import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
	root: 'src/app',
	build: {
		outDir: '../../dist',
		emptyOutDir: true
	},
	server: {
		proxy: {
			'/api': 'http://localhost:8787',
			'/ws': {
				target: 'ws://localhost:8787',
				ws: true
			}
		}
	}
});
