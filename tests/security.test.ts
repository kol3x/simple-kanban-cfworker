/// <reference types="@cloudflare/vitest-pool-workers" />

import { SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { authed, findItem, freshColumn, openSocket, snapshot, TEST_KEY } from './helpers';
import type { BoardState } from '../src/shared/types';

beforeEach(async () => {
	const board = await snapshot();
	const socket = await openSocket();
	try {
		for (const col of board.columns) {
			await socket.send({ type: 'column.delete', id: col.id });
		}
	} finally {
		socket.close();
	}
});

describe('authentication', () => {
	it('rejects /api/board without credentials', async () => {
		const res = await SELF.fetch('https://example.com/api/board');
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: 'unauthorized' });
	});

	it('rejects /api/board with a wrong key', async () => {
		const res = await SELF.fetch('https://example.com/api/board', {
			headers: { authorization: 'Bearer wrong-key' }
		});
		expect(res.status).toBe(401);
	});

	it('rejects malformed Authorization headers', async () => {
		for (const value of ['Bearer', `Basic ${TEST_KEY}`, 'Bearer  ', TEST_KEY]) {
			const res = await SELF.fetch('https://example.com/api/board', {
				headers: { authorization: value }
			});
			expect(res.status).toBe(401);
		}
	});

	it('rejects query-param key on HTTP API', async () => {
		const res = await SELF.fetch(`https://example.com/api/board?key=${TEST_KEY}`);
		// query param is only allowed for the WS handshake
		expect(res.status).toBe(401);
	});

	it('accepts key as query param on websocket upgrade (browser constraint)', async () => {
		const res = await SELF.fetch(`https://example.com/ws?key=${TEST_KEY}`, {
			headers: { upgrade: 'websocket' }
		});
		expect(res.status).toBe(101);
		res.webSocket?.accept();
		res.webSocket?.close();
	});

	it('rejects websocket upgrade with wrong key', async () => {
		const res = await SELF.fetch('https://example.com/ws?key=wrong-key', {
			headers: { upgrade: 'websocket' }
		});
		expect(res.status).toBe(401);
	});

	it('rejects websocket upgrade without key', async () => {
		const res = await SELF.fetch('https://example.com/ws', {
			headers: { upgrade: 'websocket' }
		});
		expect(res.status).toBe(401);
	});

	it('rejects /ws without an upgrade header even when authorized', async () => {
		const res = await SELF.fetch(`https://example.com/ws?key=${TEST_KEY}`);
		expect(res.status).toBe(400);
	});

	it('404s unknown API paths', async () => {
		const res = await SELF.fetch('https://example.com/api/secret', authed());
		expect(res.status).toBe(404);
	});
});

describe('input validation', () => {
	async function makeItem(title: string) {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		const msg = await socket.send({ type: 'item.create', columnId: colId, title });
		const id = findItem(msg['board'] as BoardState, title)!.id;
		socket.close();
		return { colId, id };
	}

	it('rejects unknown op types without corrupting state', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(JSON.stringify({ type: 'board.drop', table: 'items' }));
			const err = await socket.waitFor((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('unknown op type');
			// socket still usable afterwards
			const colId = await freshColumn('Still works');
			const board = await snapshot();
			expect(board.columns.some((c) => c.id === colId)).toBe(true);
		} finally {
			socket.close();
		}
	});

	it('rejects invalid JSON', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send('this is not json');
			const err = await socket.waitFor((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('invalid JSON');
		} finally {
			socket.close();
		}
	});

	it('rejects oversized titles', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(
				JSON.stringify({ type: 'column.create', title: 'x'.repeat(2001) })
			);
			const err = await socket.waitFor((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('too long');
		} finally {
			socket.close();
		}
	});

	it('rejects empty titles', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(JSON.stringify({ type: 'column.create', title: '   ' }));
			const err = await socket.waitFor((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('empty');
		} finally {
			socket.close();
		}
	});

	it('rejects invalid colors, deadlines and index types', async () => {
		const colId = await freshColumn('Col');
		const { id } = await makeItem('item');
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(JSON.stringify({ type: 'item.update', id, color: 'chartreuse' }));
			await socket.next((m) => m['type'] === 'error');
			socket.ws.send(JSON.stringify({ type: 'item.update', id, deadline: 'tomorrow' }));
			await socket.next((m) => m['type'] === 'error');
			socket.ws.send(
				JSON.stringify({ type: 'item.move', id, toColumnId: colId, index: -5 })
			);
			await socket.next((m) => m['type'] === 'error');
			socket.ws.send(
				JSON.stringify({ type: 'item.move', id, toColumnId: colId, index: 1.5 })
			);
			await socket.next((m) => m['type'] === 'error');
		} finally {
			socket.close();
		}
	});

	it('stores SQL injection attempts as literal text, state intact', async () => {
		const colId = await freshColumn('Col');
		const evil = "x'); DROP TABLE items; --";
		const socket = await openSocket();
		try {
			const msg = await socket.send({ type: 'item.create', columnId: colId, title: evil });
			const board = msg['board'] as BoardState;
			expect(board.items.some((i) => i.title === evil)).toBe(true);
			expect(board.items.length).toBe(1);
			// table still functional
			await socket.send({ type: 'item.create', columnId: colId, title: 'after injection' });
		} finally {
			socket.close();
		}
	});

	it('rejects invalid optional fields on item.create', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(
				JSON.stringify({
					type: 'item.create',
					columnId: colId,
					title: 'ok',
					color: 'chartreuse'
				})
			);
			const err = await socket.next((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('color');
			socket.ws.send(
				JSON.stringify({
					type: 'item.create',
					columnId: colId,
					title: 'ok',
					deadline: '31-12-2030'
				})
			);
			const err2 = await socket.next((m) => m['type'] === 'error');
			expect(String(err2['error'])).toContain('deadline');
			// nothing was created
			const board = await snapshot();
			expect(board.items.length).toBe(0);
		} finally {
			socket.close();
		}
	});

	it('rejects invalid hex and unknown color ids', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(JSON.stringify({ type: 'color.update', id: 'blue', hex: 'blue' }));
			const err = await socket.next((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('hex');
			socket.ws.send(JSON.stringify({ type: 'color.update', id: 'does-not-exist', name: 'x' }));
			const err2 = await socket.next((m) => m['type'] === 'error');
			expect(String(err2['error'])).toContain('color not found');
			socket.ws.send(JSON.stringify({ type: 'color.create', name: 'x', hex: '#12345' }));
			const err3 = await socket.next((m) => m['type'] === 'error');
			expect(String(err3['error'])).toContain('hex');
			socket.ws.send(
				JSON.stringify({ type: 'item.update', id: 'whatever', color: 'not-in-palette' })
			);
			const err4 = await socket.next((m) => m['type'] === 'error');
			expect(String(err4['error'])).toContain('color not found');
		} finally {
			socket.close();
		}
	});

	it('rejects ops referencing nonexistent columns/items', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(
				JSON.stringify({ type: 'item.create', columnId: 'does-not-exist', title: 'nope' })
			);
			const err = await socket.next((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('column not found');
			socket.ws.send(JSON.stringify({ type: 'item.delete', id: 'does-not-exist' }));
			const err2 = await socket.next((m) => m['type'] === 'error');
			expect(String(err2['error'])).toContain('item not found');
		} finally {
			socket.close();
		}
	});

	it('silently ignores non-object op payloads', async () => {
		const socket = await openSocket();
		try {
			await socket.waitFor((m) => m['type'] === 'snapshot');
			socket.ws.send(JSON.stringify(['not', 'an', 'op']));
			const err = await socket.waitFor((m) => m['type'] === 'error');
			expect(String(err['error'])).toContain('must be an object');
		} finally {
			socket.close();
		}
	});
});
