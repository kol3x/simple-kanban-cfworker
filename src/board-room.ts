import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_COLORS } from './shared/types';
import { REPORT_SYSTEM_INSTRUCTION, buildReportPrompt } from './shared/report';
import { validateOp } from './shared/validate';
import type { BoardState, ColorDef, ItemState, Op, Report } from './shared/types';

interface Env {
	BOARD: DurableObjectNamespace;
	OPENROUTER_API_KEY?: string;
	OPENROUTER_MODEL?: string;
}

interface ItemRow {
	id: string;
	column_id: string;
	position: number;
	title: string;
	description: string;
	deadline: string | null;
	done_date: string | null;
	color: string;
	created_at: number;
	updated_at: number;
}

interface ColumnRow {
	id: string;
	title: string;
	position: number;
	collapsed: number;
	date_grouped: number;
}

interface ColorRow {
	id: string;
	name: string;
	hex: string;
	position: number;
}

const DEFAULT_COLUMNS = ['To Do', 'Doing', 'Done'];

export class BoardRoom extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS columns (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			position INTEGER NOT NULL,
			collapsed INTEGER NOT NULL DEFAULT 0,
			date_grouped INTEGER NOT NULL DEFAULT 0
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS items (
			id TEXT PRIMARY KEY,
			column_id TEXT NOT NULL,
			position INTEGER NOT NULL,
			title TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			deadline TEXT,
			done_date TEXT,
			color TEXT NOT NULL DEFAULT 'none',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`);
		// migrations for boards created before these columns existed
		for (const stmt of [
			'ALTER TABLE columns ADD COLUMN date_grouped INTEGER NOT NULL DEFAULT 0',
			'ALTER TABLE items ADD COLUMN done_date TEXT'
		]) {
			try {
				this.ctx.storage.sql.exec(stmt);
			} catch {
				// column already exists
			}
		}
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reports (
			day TEXT PRIMARY KEY,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS colors (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			hex TEXT NOT NULL,
			position INTEGER NOT NULL
		)`);
		if (this.#count('colors') === 0) {
			for (const [i, def] of DEFAULT_COLORS.entries()) {
				this.ctx.storage.sql.exec(
					'INSERT INTO colors (id, name, hex, position) VALUES (?, ?, ?, ?)',
					def.id,
					def.id.charAt(0).toUpperCase() + def.id.slice(1),
					def.hex,
					i
				);
			}
		}
		if (this.#count('columns') === 0) {
			for (const title of DEFAULT_COLUMNS) {
				this.#insertColumn(title);
			}
		}
		// repaint untouched defaults with the fun palette (items keep their color ids)
		for (const def of DEFAULT_COLORS) {
			this.ctx.storage.sql.exec(
				'UPDATE colors SET hex = ? WHERE id = ? AND name = ?',
				def.hex,
				def.id,
				def.id.charAt(0).toUpperCase() + def.id.slice(1)
			);
		}
	}

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/snapshot') {
			return new Response(JSON.stringify(this.#snapshot()), {
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.pathname === '/report/generate') {
			// internal route — only reachable from the worker's scheduled handler
			return this.#generateReport();
		}
		if (url.pathname === '/ws') {
			if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
				return new Response('expected websocket upgrade', { status: 400 });
			}
			const pair = new WebSocketPair();
			const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
			this.ctx.acceptWebSocket(server);
			server.send(JSON.stringify({ type: 'snapshot', board: this.#snapshot(), report: this.#latestReport() }));
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response('not found', { status: 404 });
	}

	override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== 'string') {
			this.#sendError(ws, 'messages must be JSON text');
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(message);
		} catch {
			this.#sendError(ws, 'invalid JSON');
			return;
		}
		const result = validateOp(parsed);
		if (!result.ok) {
			this.#sendError(ws, result.error);
			return;
		}
		try {
			this.#apply(result.value);
		} catch (e) {
			this.#sendError(ws, `op failed: ${e instanceof Error ? e.message : 'unknown error'}`);
			return;
		}
		this.#broadcastSnapshot();
	}

	override async webSocketClose(): Promise<void> {
		// nothing to clean up; connections are stateless beyond the board
	}

	override async webSocketError(): Promise<void> {
		// socket erroring is equivalent to it being gone
	}

	#sendError(ws: WebSocket, error: string): void {
		try {
			ws.send(JSON.stringify({ type: 'error', error }));
		} catch {
			// socket already gone
		}
	}

	#broadcast(msg: string): void {
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(msg);
			} catch {
				// ignore dead sockets; close/error handlers clean up
			}
		}
	}

	#broadcastSnapshot(): void {
		this.#broadcast(JSON.stringify({ type: 'snapshot', board: this.#snapshot() }));
	}

	#latestReport(): Report | null {
		const rows = this.ctx.storage.sql
			.exec('SELECT day, content, created_at FROM reports ORDER BY day DESC LIMIT 1')
			.toArray() as unknown as Array<{ day: string; content: string; created_at: number }>;
		const r = rows[0];
		return r ? { day: r.day, content: r.content, generatedAt: r.created_at } : null;
	}

	#json(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	}

	/** Generate today's report via OpenRouter, cache it per UTC day, push to live clients. */
	async #generateReport(): Promise<Response> {
		if (!this.env.OPENROUTER_API_KEY) {
			return this.#json({ error: 'OPENROUTER_API_KEY not configured' }, 503);
		}
		const day = new Date().toISOString().slice(0, 10);
		const existing = (
			this.ctx.storage.sql
				.exec('SELECT day, content, created_at FROM reports WHERE day = ?', day)
				.toArray() as unknown as Array<{ day: string; content: string; created_at: number }>
		)[0];
		if (existing) return this.#json({ day: existing.day, content: existing.content, generatedAt: existing.created_at });

		let content = '';
		try {
			const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: {
					authorization: `Bearer ${this.env.OPENROUTER_API_KEY}`,
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					model: this.env.OPENROUTER_MODEL || 'z-ai/glm-5.3',
					messages: [
						{ role: 'system', content: REPORT_SYSTEM_INSTRUCTION },
						{ role: 'user', content: buildReportPrompt(this.#snapshot()) }
					]
				})
			});
			if (!res.ok) {
				const detail = (await res.text()).slice(0, 300);
				return this.#json({ error: `openrouter ${res.status}: ${detail}` }, 502);
			}
			const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
			content = data.choices?.[0]?.message?.content?.trim() ?? '';
		} catch (e) {
			return this.#json({ error: `openrouter request failed: ${e instanceof Error ? e.message : 'unknown'}` }, 502);
		}
		if (!content) return this.#json({ error: 'openrouter returned an empty completion' }, 502);

		const report: Report = { day, content, generatedAt: Date.now() };
		this.ctx.storage.sql.exec(
			'INSERT INTO reports (day, content, created_at) VALUES (?, ?, ?)',
			report.day,
			report.content,
			report.generatedAt
		);
		this.#broadcast(JSON.stringify({ type: 'report', report }));
		return this.#json(report);
	}

	#count(table: 'columns' | 'items' | 'colors'): number {
		const rows = this.ctx.storage.sql
			.exec(`SELECT COUNT(*) AS n FROM ${table}`)
			.toArray() as Array<{ n: number }>;
		return rows[0]?.n ?? 0;
	}

	#insertColumn(title: string): string {
		const id = crypto.randomUUID();
		const rows = this.ctx.storage.sql
			.exec('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM columns')
			.toArray() as Array<{ p: number }>;
		const position = rows[0]?.p ?? 0;
		this.ctx.storage.sql.exec('INSERT INTO columns (id, title, position, collapsed) VALUES (?, ?, ?, 0)', id, title, position);
		return id;
	}

	#snapshot(): BoardState {
		const colors = (
			this.ctx.storage.sql.exec('SELECT * FROM colors ORDER BY position').toArray() as unknown as ColorRow[]
		).map(
			(c): ColorDef => ({
				id: c.id,
				name: c.name,
				hex: c.hex
			})
		);
		const columns = (
			this.ctx.storage.sql.exec('SELECT * FROM columns ORDER BY position').toArray() as unknown as ColumnRow[]
		).map((c) => ({
			id: c.id,
			title: c.title,
			position: c.position,
			collapsed: c.collapsed !== 0,
			dateGrouped: c.date_grouped !== 0
		}));
		const items = (
			this.ctx.storage.sql.exec('SELECT * FROM items ORDER BY column_id, position').toArray() as unknown as ItemRow[]
		).map(
			(i): ItemState => ({
				id: i.id,
				columnId: i.column_id,
				position: i.position,
				title: i.title,
				description: i.description,
				deadline: i.deadline,
				doneDate: i.done_date,
				color: i.color as ItemState['color'],
				createdAt: i.created_at,
				updatedAt: i.updated_at
			})
		);
		return { colors, columns, items };
	}

	/** Renumber `position` as 0..n-1 preserving current order. */
	#renumber(columnId?: string, table: 'columns' | 'items' = 'items'): void {
		if (table === 'columns') {
			const ids = (
				this.ctx.storage.sql.exec('SELECT id FROM columns ORDER BY position').toArray() as Array<{
					id: string;
				}>
			).map((r) => r.id);
			for (let i = 0; i < ids.length; i++) {
				this.ctx.storage.sql.exec('UPDATE columns SET position = ? WHERE id = ?', i, ids[i]);
			}
			return;
		}
		const where = columnId ? 'WHERE column_id = ?' : '';
		const params: unknown[] = columnId ? [columnId] : [];
		// date-grouped columns keep position == flat display order (newest day first)
		const grouped = columnId ? this.#isGrouped(columnId) : false;
		const order = grouped
			? 'ORDER BY done_date DESC, position, created_at'
			: 'ORDER BY position, created_at';
		const rows = this.ctx.storage.sql
			.exec(
				`SELECT id FROM items ${where} ${order}`,
				...params
			)
			.toArray() as unknown as Array<{ id: string }>;
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			if (row) this.ctx.storage.sql.exec('UPDATE items SET position = ? WHERE id = ?', i, row.id);
		}
	}

	#isGrouped(columnId: string): boolean {
		const rows = this.ctx.storage.sql
			.exec('SELECT date_grouped FROM columns WHERE id = ?', columnId)
			.toArray() as unknown as Array<{ date_grouped: number }>;
		return (rows[0]?.date_grouped ?? 0) !== 0;
	}

	#colorExists(id: string): boolean {
		if (id === 'none') return true;
		const rows = this.ctx.storage.sql
			.exec('SELECT id FROM colors WHERE id = ?', id)
			.toArray() as unknown as Array<{ id: string }>;
		return rows.length > 0;
	}

	#apply(op: Op): void {
		switch (op.type) {
			case 'color.update': {
				if (!this.#colorExists(op.id)) throw new Error('color not found');
				if (op.name !== undefined) {
					this.ctx.storage.sql.exec('UPDATE colors SET name = ? WHERE id = ?', op.name, op.id);
				}
				if (op.hex !== undefined) {
					this.ctx.storage.sql.exec('UPDATE colors SET hex = ? WHERE id = ?', op.hex, op.id);
				}
				return;
			}
			case 'color.create': {
				const id = op.id ?? crypto.randomUUID();
				if (this.#colorExists(id)) throw new Error('color already exists');
				const posRows = this.ctx.storage.sql
					.exec('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM colors')
					.toArray() as unknown as Array<{ p: number }>;
				const position = posRows[0]?.p ?? 0;
				this.ctx.storage.sql.exec(
					'INSERT INTO colors (id, name, hex, position) VALUES (?, ?, ?, ?)',
					id,
					op.name,
					op.hex,
					position
				);
				return;
			}
			case 'column.create': {
				this.#insertColumn(op.title);
				return;
			}
			case 'column.rename': {
				this.ctx.storage.sql.exec('UPDATE columns SET title = ? WHERE id = ?', op.title, op.id);
				return;
			}
			case 'column.toggleCollapse': {
				this.ctx.storage.sql.exec(
					'UPDATE columns SET collapsed = 1 - collapsed WHERE id = ?',
					op.id
				);
				return;
			}
			case 'column.setDateGrouped': {
				const exists = (
					this.ctx.storage.sql
						.exec('SELECT id FROM columns WHERE id = ?', op.id)
						.toArray() as Array<{ id: string }>
				)[0];
				if (!exists) throw new Error('column not found');
				this.ctx.storage.sql.exec(
					'UPDATE columns SET date_grouped = ? WHERE id = ?',
					op.value ? 1 : 0,
					op.id
				);
				if (op.value) {
					// items already in the column get stamped with the day they were
					// last touched — a good approximation of when they landed here
					this.ctx.storage.sql.exec(
						"UPDATE items SET done_date = strftime('%Y-%m-%d', updated_at / 1000, 'unixepoch') WHERE column_id = ? AND done_date IS NULL",
						op.id
					);
					this.#renumber(op.id);
				}
				return;
			}
			case 'column.delete': {
				this.ctx.storage.sql.exec('DELETE FROM items WHERE column_id = ?', op.id);
				this.ctx.storage.sql.exec('DELETE FROM columns WHERE id = ?', op.id);
				this.#renumber(undefined, 'columns');
				return;
			}
			case 'item.create': {
				const col = (
					this.ctx.storage.sql
						.exec('SELECT id FROM columns WHERE id = ?', op.columnId)
						.toArray() as Array<{ id: string }>
				)[0];
				if (!col) throw new Error('column not found');
				if (op.color !== undefined && !this.#colorExists(op.color)) {
					throw new Error('color not found');
				}
				const n = (
					this.ctx.storage.sql
						.exec(
							'SELECT COUNT(*) AS n FROM items WHERE column_id = ?',
							op.columnId
						)
						.toArray() as Array<{ n: number }>
				)[0]?.n ?? 0;
				const index = op.index === undefined ? n : Math.min(op.index, n);
				// shift existing items at/after index
				this.ctx.storage.sql.exec(
					'UPDATE items SET position = position + 1 WHERE column_id = ? AND position >= ?',
					op.columnId,
					index
				);
				const now = Date.now();
				const doneDate = this.#isGrouped(op.columnId)
					? new Date(now).toISOString().slice(0, 10)
					: null;
				this.ctx.storage.sql.exec(
					`INSERT INTO items (id, column_id, position, title, description, deadline, done_date, color, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					crypto.randomUUID(),
					op.columnId,
					index,
					op.title,
					op.description ?? '',
					op.deadline ?? null,
					doneDate,
					op.color ?? 'none',
					now,
					now
				);
				return;
			}
			case 'item.update': {
				if (op.color !== undefined && !this.#colorExists(op.color)) {
					throw new Error('color not found');
				}
				const sets: string[] = ['updated_at = ?'];
				const params: unknown[] = [Date.now()];
				if (op.title !== undefined) {
					sets.push('title = ?');
					params.push(op.title);
				}
				if (op.description !== undefined) {
					sets.push('description = ?');
					params.push(op.description);
				}
				if (op.deadline !== undefined) {
					sets.push('deadline = ?');
					params.push(op.deadline);
				}
				if (op.color !== undefined) {
					sets.push('color = ?');
					params.push(op.color);
				}
				params.push(op.id);
				this.ctx.storage.sql.exec(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`, ...params);
				return;
			}
			case 'item.move': {
				const col = (
					this.ctx.storage.sql
						.exec('SELECT id FROM columns WHERE id = ?', op.toColumnId)
						.toArray() as Array<{ id: string }>
				)[0];
				if (!col) throw new Error('column not found');
				const item = (
					this.ctx.storage.sql
						.exec('SELECT column_id, position, done_date FROM items WHERE id = ?', op.id)
						.toArray() as Array<{ column_id: string; position: number; done_date: string | null }>
				)[0];
				if (!item) throw new Error('item not found');
				const from = item.column_id;
				// close gap in source column
				this.ctx.storage.sql.exec(
					'UPDATE items SET position = position - 1 WHERE column_id = ? AND position > ?',
					from,
					item.position
				);
				if (this.#isGrouped(op.toColumnId)) {
					// the item adopts the day of the group it is dropped into: the
					// card above the insertion point wins (at a boundary that means
					// the group it was dropped at the end of); empty column → today.
					// Dragging between groups is how items get re-dated / backfilled.
					const rows = this.ctx.storage.sql
						.exec(
							'SELECT id, done_date FROM items WHERE column_id = ? AND id != ? ORDER BY done_date DESC, position, created_at',
							op.toColumnId,
							op.id
						)
						.toArray() as unknown as Array<{ id: string; done_date: string | null }>;
					const gi = Math.min(Math.max(op.index, 0), rows.length);
					const above = gi > 0 ? rows[gi - 1] : undefined;
					const today = new Date().toISOString().slice(0, 10);
					const date = above?.done_date ?? today;
					rows.splice(gi, 0, { id: op.id, done_date: date });
					this.ctx.storage.sql.exec(
						'UPDATE items SET column_id = ?, done_date = ?, updated_at = ? WHERE id = ?',
						op.toColumnId,
						date,
						Date.now(),
						op.id
					);
					// positions = flat display order (newest day first)
					for (let i = 0; i < rows.length; i++) {
						const row = rows[i];
						if (row) {
							this.ctx.storage.sql.exec('UPDATE items SET position = ? WHERE id = ?', i, row.id);
						}
					}
					if (from !== op.toColumnId) this.#renumber(from);
					return;
				}
				const n = (
					this.ctx.storage.sql
						.exec('SELECT COUNT(*) AS n FROM items WHERE column_id = ?', op.toColumnId)
						.toArray() as Array<{ n: number }>
				)[0]?.n ?? 0;
				const index = Math.min(op.index, n);
				this.ctx.storage.sql.exec(
					'UPDATE items SET position = position + 1 WHERE column_id = ? AND position >= ?',
					op.toColumnId,
					index
				);
				this.ctx.storage.sql.exec(
					'UPDATE items SET column_id = ?, position = ?, done_date = NULL, updated_at = ? WHERE id = ?',
					op.toColumnId,
					index,
					Date.now(),
					op.id
				);
				this.#renumber(from);
				if (op.toColumnId !== from) this.#renumber(op.toColumnId);
				return;
			}
			case 'item.delete': {
				const item = (
					this.ctx.storage.sql
						.exec('SELECT column_id FROM items WHERE id = ?', op.id)
						.toArray() as Array<{ column_id: string }>
				)[0];
				if (!item) throw new Error('item not found');
				this.ctx.storage.sql.exec('DELETE FROM items WHERE id = ?', op.id);
				this.#renumber(item.column_id);
				return;
			}
		}
	}
}
