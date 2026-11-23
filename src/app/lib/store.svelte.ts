import type { BoardState, Color, ColumnState, ItemState, Op } from '../../shared/types';

function tempId(): string {
	return `tmp-${crypto.randomUUID().slice(0, 8)}`;
}

export class BoardStore {
	state = $state<BoardState>({ colors: [], columns: [], items: [] });
	connected = $state(false);
	needsKey = $state(false);
	loadError = $state<string | null>(null);
	/** id of item currently being dragged */
	dragging = $state<string | null>(null);
	/** where the dragged item would land */
	dropTarget = $state<{ columnId: string; index: number } | null>(null);
	editingId = $state<string | null>(null);
	/** columnId while the "new item" editor is open */
	creatingIn = $state<string | null>(null);
	/** board settings modal open (columns + palette) */
	settingsOpen = $state(false);
	/** color pre-selected for newly created items ('none' = uncolored) */
	defaultColor = $state<Color>(
		typeof localStorage !== 'undefined' ? (localStorage.getItem('kanban.defaultColor') ?? 'none') : 'none'
	);

	/** pick the default color for new items; falls back to 'none' for unknown ids */
	setDefaultColor(id: Color): void {
		if (id !== 'none' && !this.state.colors.some((c) => c.id === id)) id = 'none';
		this.defaultColor = id;
		try {
			localStorage.setItem('kanban.defaultColor', id);
		} catch {
			// storage unavailable — setting just won't persist
		}
	}

	#ws: WebSocket | null = null;
	#retries = 0;
	#key = '';
	#snapshotWaiters: Array<() => void> = [];

	itemsIn(columnId: string): ItemState[] {
		return this.state.items
			.filter((i) => i.columnId === columnId)
			.sort((a, b) => a.position - b.position);
	}

	columns(): ColumnState[] {
		return [...this.state.columns].sort((a, b) => a.position - b.position);
	}

	item(id: string): ItemState | undefined {
		return this.state.items.find((i) => i.id === id);
	}

	colorHex(id: string): string | undefined {
		return this.state.colors.find((c) => c.id === id)?.hex;
	}

	colorName(id: string): string {
		return this.state.colors.find((c) => c.id === id)?.name ?? id;
	}

	async init(key: string): Promise<boolean> {
		this.#key = key;
		this.loadError = null;
		let res: Response;
		try {
			res = await fetch('/api/board', { headers: { authorization: `Bearer ${key}` } });
		} catch {
			this.loadError = 'Cannot reach the server — is `npm run dev:backend` running?';
			return false;
		}
		if (res.status === 401) {
			this.needsKey = true;
			return false;
		}
		if (!res.ok) {
			this.loadError = `Server error: ${res.status}`;
			return false;
		}
		this.state = await res.json();
		// stored default color may reference a color that no longer exists
		if (this.defaultColor !== 'none' && !this.colorHex(this.defaultColor)) {
			this.setDefaultColor('none');
		}
		this.needsKey = false;
		this.#connect();
		return true;
	}

	#connect(): void {
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const ws = new WebSocket(`${proto}://${location.host}/ws?key=${encodeURIComponent(this.#key)}`);
		this.#ws = ws;
		ws.onopen = () => {
			this.connected = true;
			this.#retries = 0;
		};
		ws.onmessage = (e) => {
			const msg = JSON.parse(e.data) as { type: string; board?: BoardState };
			if (msg.type === 'snapshot' && msg.board) {
				this.state = msg.board;
				for (const w of this.#snapshotWaiters.splice(0)) w();
			}
		};
		ws.onclose = () => {
			this.connected = false;
			this.#ws = null;
			const delay = Math.min(500 * 2 ** this.#retries++, 8000);
			setTimeout(() => this.#connect(), delay);
		};
		ws.onerror = () => ws.close();
	}

	send(op: Op): void {
		this.#applyLocal(op);
		if (this.#ws?.readyState === WebSocket.OPEN) {
			this.#ws.send(JSON.stringify(op));
		}
	}

	/** send an op and resolve once the server's authoritative snapshot arrived */
	sendAsync(op: Op): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('timeout waiting for snapshot')), 10_000);
			this.#snapshotWaiters.push(() => {
				clearTimeout(timeout);
				resolve();
			});
			this.send(op);
		});
	}

	#applyLocal(op: Op): void {
		const s = this.state;
		switch (op.type) {
			case 'color.update': {
				const c = s.colors.find((c) => c.id === op.id);
				if (c) {
					if (op.name !== undefined) c.name = op.name;
					if (op.hex !== undefined) c.hex = op.hex;
				}
				return;
			}
			case 'color.create': {
				s.colors.push({ id: op.id ?? tempId(), name: op.name, hex: op.hex });
				return;
			}
			case 'column.create': {
				s.columns.push({ id: tempId(), title: op.title, position: s.columns.length, collapsed: false });
				break;
			}
			case 'column.rename': {
				const c = s.columns.find((c) => c.id === op.id);
				if (c) c.title = op.title;
				break;
			}
			case 'column.toggleCollapse': {
				const c = s.columns.find((c) => c.id === op.id);
				if (c) c.collapsed = !c.collapsed;
				break;
			}
			case 'column.delete': {
				const idx = s.columns.findIndex((c) => c.id === op.id);
				if (idx !== -1) {
					s.columns.splice(idx, 1);
					s.columns.forEach((c, i) => (c.position = i));
				}
				s.items = s.items.filter((i) => i.columnId !== op.id);
				break;
			}
			case 'item.create': {
				const col = s.columns.find((c) => c.id === op.columnId);
				if (!col) break;
				const inCol = this.itemsIn(op.columnId);
				const index = Math.min(op.index ?? inCol.length, inCol.length);
				const item: ItemState = {
					id: tempId(),
					columnId: op.columnId,
					position: index,
					title: op.title,
					description: op.description ?? '',
					deadline: op.deadline ?? null,
					color: op.color ?? 'none',
					createdAt: Date.now(),
					updatedAt: Date.now()
				};
				for (const it of inCol) if (it.position >= index) it.position++;
				s.items.push(item);
				break;
			}
			case 'item.update': {
				const item = s.items.find((i) => i.id === op.id);
				if (!item) break;
				if (op.title !== undefined) item.title = op.title;
				if (op.description !== undefined) item.description = op.description;
				if (op.deadline !== undefined) item.deadline = op.deadline;
				if (op.color !== undefined) item.color = op.color;
				item.updatedAt = Date.now();
				break;
			}
			case 'item.move': {
				const item = s.items.find((i) => i.id === op.id);
				if (!item) break;
				const source = this.itemsIn(item.columnId).filter((i) => i.id !== op.id);
				for (let i = item.position + 1; i < source.length + 1; i++) {
					const it = source.find((x) => x.position === i);
					if (it) it.position--;
				}
				item.columnId = op.toColumnId;
				const target = this.itemsIn(op.toColumnId).filter((i) => i.id !== op.id);
				const index = Math.min(op.index, target.length);
				for (const it of target) if (it.position >= index) it.position++;
				item.position = index;
				break;
			}
			case 'item.delete': {
				const idx = s.items.findIndex((i) => i.id === op.id);
				if (idx !== -1) {
					const removed = s.items[idx];
					s.items.splice(idx, 1);
					if (removed) {
						for (const it of this.itemsIn(removed.columnId)) {
							if (it.position > removed.position) it.position--;
						}
					}
				}
				break;
			}
		}
	}
}

export const store = new BoardStore();
