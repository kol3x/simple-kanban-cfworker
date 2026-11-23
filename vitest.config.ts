import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// single shared DO across files -> run files sequentially
		fileParallelism: false,
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				isolatedStorage: false,
				miniflare: {
					// Test-only API key; production uses `wrangler secret put API_KEY`.
					bindings: { API_KEY: 'test-api-key-0123456789' }
				}
			}
		}
	}
});
