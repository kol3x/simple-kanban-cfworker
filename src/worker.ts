import { BoardRoom } from './board-room';

export { BoardRoom };

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function unauthorized(msg = 'unauthorized'): Response {
	return json({ error: msg }, 401);
}

/** Constant-time comparison of the presented key against the configured key. */
function keyMatches(presented: string, expected: string): boolean {
	const a = new TextEncoder().encode(presented);
	const b = new TextEncoder().encode(expected);
	// workers-types doesn't model the non-standard timingSafeEqual
	const subtle = crypto.subtle as unknown as {
		timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
	};
	if (a.byteLength !== b.byteLength) {
		// Burn comparable time anyway, then fail.
		subtle.timingSafeEqual(a, a);
		return false;
	}
	return subtle.timingSafeEqual(a, b);
}

function extractKey(request: Request, allowQuery: boolean): string | null {
	const header = request.headers.get('authorization');
	if (header !== null) {
		const m = /^Bearer\s+(.+)$/i.exec(header);
		return m && m[1] ? m[1] : null;
	}
	if (!allowQuery) return null;
	// Browsers cannot set headers on WebSocket, so /ws also accepts ?key=
	const url = new URL(request.url);
	return url.searchParams.get('key');
}

function authorized(request: Request, env: Env, allowQuery = false): boolean {
	// Fail closed: no key configured means nothing is authorized.
	if (typeof env.API_KEY !== 'string' || env.API_KEY.length === 0) return false;
	const presented = extractKey(request, allowQuery);
	if (presented === null) return false;
	return keyMatches(presented, env.API_KEY);
}

export default {
	// Daily report, Mon–Fri at 07:00 UTC. The DO skips if a report for today
	// already exists, so manual re-triggers (e.g. `__scheduled` in dev) are safe.
	async scheduled(_controller, env): Promise<void> {
		const dow = new Date().getUTCDay();
		// NB: JS getUTCDay() numbering (0 = Sunday) — differs from the cron string,
		// where Cloudflare uses Quartz numbering (1 = Sunday), see wrangler.jsonc
		if (dow === 0 || dow === 6) return; // belt & braces; cron already filters weekends
		if (!env.OPENROUTER_API_KEY) {
			console.error('daily report skipped: OPENROUTER_API_KEY not set');
			return;
		}
		const stub = env.BOARD.get(env.BOARD.idFromName('main'));
		const res = await stub.fetch('https://board-room/report/generate', { method: 'POST' });
		if (!res.ok) {
			console.error('daily report failed:', res.status, await res.text());
		}
	},

	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname !== '/api/board' && url.pathname !== '/ws') {
			// Unknown /api/* paths must not fall through to the SPA
			if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
			return env.ASSETS.fetch(request);
		}

		if (!authorized(request, env, url.pathname === '/ws')) return unauthorized();

		const stub = env.BOARD.get(env.BOARD.idFromName('main'));

		if (url.pathname === '/api/board') {
			return stub.fetch('https://board-room/snapshot');
		}

		// /ws
		if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
			return json({ error: 'expected websocket upgrade' }, 400);
		}
		return stub.fetch(request);
	}
} satisfies ExportedHandler<Env>;
