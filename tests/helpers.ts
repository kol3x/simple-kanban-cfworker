/// <reference types="@cloudflare/vitest-pool-workers" />

import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';
import type { BoardState, ItemState, Op } from '../src/shared/types';

export const TEST_KEY = 'test-api-key-0123456789';

export function authed(init: RequestInit = {}): RequestInit {
	return {
		...init,
		headers: { ...(init.headers ?? {}), authorization: `Bearer ${TEST_KEY}` }
	};
}

export async function snapshot(): Promise<BoardState> {
	const res = await SELF.fetch('https://example.com/api/board', authed());
	expect(res.status).toBe(200);
	return (await res.json()) as BoardState;
}

export interface TestSocket {
	ws: WebSocket;
	messages: Array<Record<string, unknown>>;
	/** resolves when a matching message arrives (after all seen so far unless `after` given) */
	waitFor(
		pred: (msg: Record<string, unknown>) => boolean,
		after?: number,
		timeoutMs?: number
	): Promise<Record<string, unknown>>;
	/** wait for the next message matching pred, ignoring anything already seen */
	next(pred: (msg: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
	/** send an op and wait for the next snapshot broadcast */
	send(op: Op): Promise<Record<string, unknown>>;
	close(): void;
}

export async function openSocket(): Promise<TestSocket> {
	const res = await SELF.fetch(`https://example.com/ws?key=${TEST_KEY}`, {
		headers: { upgrade: 'websocket' }
	});
	expect(res.status).toBe(101);
	const ws = res.webSocket;
	if (!ws) throw new Error('no webSocket in upgrade response');
	ws.accept();

	const messages: Array<Record<string, unknown>> = [];
	const waiters: Array<{
		from: number;
		pred: (m: Record<string, unknown>) => boolean;
		resolve: (m: Record<string, unknown>) => void;
	}> = [];

	ws.addEventListener('message', (e: MessageEvent) => {
		const msg = JSON.parse(String(e.data)) as Record<string, unknown>;
		messages.push(msg);
		const i = waiters.findIndex(
			(w) => messages.indexOf(msg) >= w.from && w.pred(msg)
		);
		if (i !== -1) {
			const waiter = waiters.splice(i, 1)[0];
			if (waiter) waiter.resolve(msg);
		}
	});

	const waitFor = (
		pred: (m: Record<string, unknown>) => boolean,
		after = 0,
		timeoutMs = 3000
	): Promise<Record<string, unknown>> => {
		const existing = messages.slice(after).find(pred);
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve, reject) => {
			waiters.push({
				from: messages.length,
				pred,
				resolve
			});
			setTimeout(() => reject(new Error('waitFor timeout')), timeoutMs);
		});
	};

	/** wait for the next message matching pred, ignoring anything already seen */
	const next = (pred: (m: Record<string, unknown>) => boolean) =>
		waitFor(pred, messages.length);

	const send = (op: Op) => {
		const before = messages.length;
		ws.send(JSON.stringify(op));
		return waitFor((m) => m['type'] === 'snapshot', before);
	};

	// wait for the DO's initial snapshot so callers start from a known state
	await waitFor((m) => m['type'] === 'snapshot');

	return { ws, messages, waitFor, next, send, close: () => ws.close() };
}

export function findItem(board: BoardState, title: string): ItemState | undefined {
	return board.items.find((i) => i.title === title);
}

export function itemsIn(board: BoardState, columnId: string): ItemState[] {
	return board.items
		.filter((i) => i.columnId === columnId)
		.sort((a, b) => a.position - b.position);
}

export async function freshColumn(title: string): Promise<string> {
	const board = await snapshot();
	const before = board.columns.length;
	const socket = await openSocket();
	try {
		const msg = await socket.send({ type: 'column.create', title });
		const b = msg['board'] as BoardState;
		expect(b.columns.length).toBe(before + 1);
		const col = b.columns.find((c) => c.title === title);
		if (!col) throw new Error('column not created');
		return col.id;
	} finally {
		socket.close();
	}
}
