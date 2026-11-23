/// <reference types="@cloudflare/vitest-pool-workers" />

import { beforeEach, describe, expect, it } from 'vitest';
import { findItem, freshColumn, itemsIn, openSocket, snapshot } from './helpers';
import type { BoardState } from '../src/shared/types';

beforeEach(async () => {
	// reset the board between tests by deleting all columns (cascades items)
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

describe('snapshot API', () => {
	it('returns an empty board over HTTP with valid key', async () => {
		const board = await snapshot();
		expect(board.columns).toEqual([]);
		expect(board.items).toEqual([]);
	});
});

describe('columns', () => {
	it('creates a column and reports it in snapshot', async () => {
		const id = await freshColumn('Backlog');
		const board = await snapshot();
		expect(board.columns.map((c) => c.id)).toContain(id);
	});

	it('renames a column', async () => {
		const id = await freshColumn('Old');
		const socket = await openSocket();
		try {
			const msg = await socket.send({ type: 'column.rename', id, title: 'New' });
			const board = msg['board'] as BoardState;
			expect(board.columns.find((c) => c.id === id)?.title).toBe('New');
		} finally {
			socket.close();
		}
	});

	it('toggles collapse state', async () => {
		const id = await freshColumn('Collapsible');
		const socket = await openSocket();
		try {
			let msg = await socket.send({ type: 'column.toggleCollapse', id });
			expect((msg['board'] as BoardState).columns.find((c) => c.id === id)?.collapsed).toBe(true);
			msg = await socket.send({ type: 'column.toggleCollapse', id });
			expect((msg['board'] as BoardState).columns.find((c) => c.id === id)?.collapsed).toBe(false);
		} finally {
			socket.close();
		}
	});

	it('appends columns in creation order', async () => {
		await freshColumn('A');
		await freshColumn('B');
		await freshColumn('C');
		const board = await snapshot();
		const titles = board.columns
			.sort((a, b) => a.position - b.position)
			.map((c) => c.title);
		expect(titles).toEqual(['A', 'B', 'C']);
	});
});

describe('items', () => {
	it('creates an item at the end of a column by default', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: colId, title: 'First' });
			const msg = await socket.send({ type: 'item.create', columnId: colId, title: 'Second' });
			const items = itemsIn(msg['board'] as BoardState, colId);
			expect(items.map((i) => i.title)).toEqual(['First', 'Second']);
			expect(items.map((i) => i.position)).toEqual([0, 1]);
		} finally {
			socket.close();
		}
	});

	it('creates an item at a specific index, shifting the rest', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: colId, title: 'A' });
			await socket.send({ type: 'item.create', columnId: colId, title: 'B' });
			const msg = await socket.send({
				type: 'item.create',
				columnId: colId,
				title: 'X',
				index: 1
			});
			expect(itemsIn(msg['board'] as BoardState, colId).map((i) => i.title)).toEqual([
				'A',
				'X',
				'B'
			]);
		} finally {
			socket.close();
		}
	});

	it('creates an item with description, deadline and color in one op', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			const msg = await socket.send({
				type: 'item.create',
				columnId: colId,
				title: 'Full item',
				description: 'details here',
				deadline: '2030-05-01',
				color: 'blue'
			});
			const item = findItem(msg['board'] as BoardState, 'Full item')!;
			expect(item.description).toBe('details here');
			expect(item.deadline).toBe('2030-05-01');
			expect(item.color).toBe('blue');
			expect(item.position).toBe(0);
		} finally {
			socket.close();
		}
	});

	it('updates title, description, deadline and color', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			const msg = await socket.send({ type: 'item.create', columnId: colId, title: 'Task' });
			const id = findItem(msg['board'] as BoardState, 'Task')!.id;
			const upd = await socket.send({
				type: 'item.update',
				id,
				title: 'Task renamed',
				description: 'Some details',
				deadline: '2030-01-31',
				color: 'green'
			});
			const item = findItem(upd['board'] as BoardState, 'Task renamed')!;
			expect(item.description).toBe('Some details');
			expect(item.deadline).toBe('2030-01-31');
			expect(item.color).toBe('green');
		} finally {
			socket.close();
		}
	});

	it('moves an item between columns at an index', async () => {
		const a = await freshColumn('A');
		const b = await freshColumn('B');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: a, title: 'one' });
			await socket.send({ type: 'item.create', columnId: a, title: 'two' });
			await socket.send({ type: 'item.create', columnId: b, title: 'three' });
			const board = (await snapshot()) as BoardState;
			const one = findItem(board, 'one')!;

			const msg = await socket.send({
				type: 'item.move',
				id: one.id,
				toColumnId: b,
				index: 0
			});
			const moved = msg['board'] as BoardState;
			expect(itemsIn(moved, a).map((i) => i.title)).toEqual(['two']);
			expect(itemsIn(moved, b).map((i) => i.title)).toEqual(['one', 'three']);
		} finally {
			socket.close();
		}
	});

	it('moves an item within its own column', async () => {
		const a = await freshColumn('A');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: a, title: '1' });
			await socket.send({ type: 'item.create', columnId: a, title: '2' });
			await socket.send({ type: 'item.create', columnId: a, title: '3' });
			const board = (await snapshot()) as BoardState;
			const three = findItem(board, '3')!;
			const msg = await socket.send({
				type: 'item.move',
				id: three.id,
				toColumnId: a,
				index: 0
			});
			expect(itemsIn(msg['board'] as BoardState, a).map((i) => i.title)).toEqual(['3', '1', '2']);
		} finally {
			socket.close();
		}
	});

	it('deletes an item and closes the gap', async () => {
		const a = await freshColumn('A');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: a, title: '1' });
			await socket.send({ type: 'item.create', columnId: a, title: '2' });
			await socket.send({ type: 'item.create', columnId: a, title: '3' });
			const board = (await snapshot()) as BoardState;
			const two = findItem(board, '2')!;
			const msg = await socket.send({ type: 'item.delete', id: two.id });
			const items = itemsIn(msg['board'] as BoardState, a);
			expect(items.map((i) => i.title)).toEqual(['1', '3']);
			expect(items.map((i) => i.position)).toEqual([0, 1]);
		} finally {
			socket.close();
		}
	});
});

describe('palette', () => {
	it('exposes the default palette in every snapshot', async () => {
		const board = await snapshot();
		expect(board.colors.length).toBeGreaterThanOrEqual(9);
		expect(board.colors.map((c) => c.id)).toContain('yellow');
		for (const c of board.colors) {
			expect(c.name.length).toBeGreaterThan(0);
			expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('renames a color; items keep referencing it', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			await socket.send({ type: 'item.create', columnId: colId, title: 'task', color: 'green' });
			const msg = await socket.send({ type: 'color.update', id: 'green', name: 'Base work' });
			const board = msg['board'] as BoardState;
			expect(board.colors.find((c) => c.id === 'green')?.name).toBe('Base work');
			expect(board.items.find((i) => i.title === 'task')?.color).toBe('green');
		} finally {
			socket.close();
		}
	});

	it('creates a color and applies it to an item', async () => {
		const colId = await freshColumn('Col');
		const socket = await openSocket();
		try {
			const cmsg = await socket.send({
				type: 'color.create',
				name: 'Urgent',
				hex: '#ff0055'
			});
			const created = (cmsg['board'] as BoardState).colors.at(-1)!;
			expect(created.name).toBe('Urgent');
			expect(created.hex).toBe('#ff0055');
			const msg = await socket.send({
				type: 'item.create',
				columnId: colId,
				title: 'painted',
				color: created.id
			});
			expect((msg['board'] as BoardState).items.find((i) => i.title === 'painted')?.color).toBe(
				created.id
			);
		} finally {
			socket.close();
		}
	});

	it('updates a color hex', async () => {
		const socket = await openSocket();
		try {
			const msg = await socket.send({ type: 'color.update', id: 'blue', hex: '#123456' });
			expect((msg['board'] as BoardState).colors.find((c) => c.id === 'blue')?.hex).toBe('#123456');
		} finally {
			socket.close();
		}
	});
});

describe('realtime', () => {
	it('broadcasts snapshots to a second connected client', async () => {
		const wsA = await openSocket();
		const wsB = await openSocket();
		try {
			await wsB.waitFor((m) => m['type'] === 'snapshot'); // initial snapshot
			const before = (wsB.messages.at(-1)?.['board'] as BoardState).columns.length;

			const msg = await wsA.send({ type: 'column.create', title: 'From A' });
			expect((msg['board'] as BoardState).columns.length).toBe(before + 1);

			// B must have received at least one snapshot with the new column
			const bBoard = await wsB.waitFor(
				(m) =>
					m['type'] === 'snapshot' &&
					(m['board'] as BoardState).columns.some((c) => c.title === 'From A')
			);
			expect((bBoard['board'] as BoardState).columns.length).toBe(before + 1);
		} finally {
			wsA.close();
			wsB.close();
		}
	});
});
