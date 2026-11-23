import { type Color, type Op } from './types';

export const LIMITS = {
	titleMax: 2_000,
	descriptionMax: 10_000,
	columnTitleMax: 100,
	colorNameMax: 50,
	maxIndex: 10_000
};

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, name: string): Result<string> {
	if (typeof v !== 'string') return { ok: false, error: `${name} must be a string` };
	return { ok: true, value: v };
}

function validTitle(v: unknown, name: string, max: number): Result<string> {
	const r = str(v, name);
	if (!r.ok) return r;
	const trimmed = r.value.trim();
	if (trimmed.length < 1) return { ok: false, error: `${name} must not be empty` };
	if (trimmed.length > max) return { ok: false, error: `${name} too long (max ${max})` };
	return { ok: true, value: trimmed };
}

function validId(v: unknown, name: string): Result<string> {
	const r = str(v, name);
	if (!r.ok) return r;
	if (!ID_RE.test(r.value)) return { ok: false, error: `${name} has invalid format` };
	return r;
}

function validIndex(v: unknown): Result<number | null> {
	if (v === undefined) return { ok: true, value: null };
	if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > LIMITS.maxIndex) {
		return { ok: false, error: 'index must be an integer between 0 and 10000' };
	}
	return { ok: true, value: v };
}

function validDeadline(v: unknown): Result<string | null> {
	if (v === undefined || v === null) return { ok: true, value: null };
	if (typeof v !== 'string' || !DATE_RE.test(v)) {
		return { ok: false, error: 'deadline must be YYYY-MM-DD or null' };
	}
	const d = new Date(`${v}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return { ok: false, error: 'deadline must be a real date' };
	return { ok: true, value: v };
}

function validColor(v: unknown): Result<Color> {
	if (typeof v !== 'string' || v.length === 0) {
		return { ok: false, error: 'color must be a non-empty string' };
	}
	// existence inside the palette is checked by the Durable Object
	if (v !== 'none' && !ID_RE.test(v)) {
		return { ok: false, error: 'color has invalid format' };
	}
	return { ok: true, value: v };
}

function validColorId(v: unknown): Result<string> {
	const r = str(v, 'color id');
	if (!r.ok) return r;
	if (!ID_RE.test(r.value)) return { ok: false, error: 'color id has invalid format' };
	return r;
}

function validHex(v: unknown): Result<string> {
	if (typeof v !== 'string' || !HEX_RE.test(v)) {
		return { ok: false, error: 'hex must be a #rrggbb color' };
	}
	return { ok: true, value: v.toLowerCase() };
}

/**
 * Validate an untrusted op. Returns a fully re-built op (never passes through
 * unexpected extra fields) or an error.
 */
export function validateOp(input: unknown): Result<Op> {
	if (!isRecord(input)) return { ok: false, error: 'op must be an object' };
	const type = input['type'];
	if (typeof type !== 'string') return { ok: false, error: 'op.type must be a string' };

	switch (type) {
		case 'color.update': {
			const id = validColorId(input['id']);
			if (!id.ok) return id;
			const out: Extract<Op, { type: 'color.update' }> = { type: 'color.update', id: id.value };
			if (input['name'] !== undefined) {
				const n = validTitle(input['name'], 'name', LIMITS.colorNameMax);
				if (!n.ok) return n;
				out.name = n.value;
			}
			if (input['hex'] !== undefined) {
				const h = validHex(input['hex']);
				if (!h.ok) return h;
				out.hex = h.value;
			}
			if (out.name === undefined && out.hex === undefined) {
				return { ok: false, error: 'color.update requires name or hex' };
			}
			return { ok: true, value: out };
		}
		case 'color.create': {
			const n = validTitle(input['name'], 'name', LIMITS.colorNameMax);
			if (!n.ok) return n;
			const h = validHex(input['hex']);
			if (!h.ok) return h;
			const out: Extract<Op, { type: 'color.create' }> = {
				type: 'color.create',
				name: n.value,
				hex: h.value
			};
			if (input['id'] !== undefined) {
				const id = validColorId(input['id']);
				if (!id.ok) return id;
				out.id = id.value;
			}
			return { ok: true, value: out };
		}
		case 'column.create': {
			const t = validTitle(input['title'], 'title', LIMITS.columnTitleMax);
			if (!t.ok) return t;
			return { ok: true, value: { type: 'column.create', title: t.value } };
		}
		case 'column.rename': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			const t = validTitle(input['title'], 'title', LIMITS.columnTitleMax);
			if (!t.ok) return t;
			return { ok: true, value: { type: 'column.rename', id: id.value, title: t.value } };
		}
		case 'column.toggleCollapse': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			return { ok: true, value: { type: 'column.toggleCollapse', id: id.value } };
		}
		case 'column.delete': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			return { ok: true, value: { type: 'column.delete', id: id.value } };
		}
		case 'item.create': {
			const columnId = validId(input['columnId'], 'columnId');
			if (!columnId.ok) return columnId;
			const t = validTitle(input['title'], 'title', LIMITS.titleMax);
			if (!t.ok) return t;
			const index = validIndex(input['index']);
			if (!index.ok) return index;
			const out: Extract<Op, { type: 'item.create' }> = {
				type: 'item.create',
				columnId: columnId.value,
				title: t.value
			};
			if (index.value !== null) out.index = index.value;
			if (input['description'] !== undefined) {
				const d = str(input['description'], 'description');
				if (!d.ok) return d;
				if (d.value.length > LIMITS.descriptionMax) {
					return { ok: false, error: `description too long (max ${LIMITS.descriptionMax})` };
				}
				out.description = d.value;
			}
			if (input['deadline'] !== undefined) {
				const dl = validDeadline(input['deadline']);
				if (!dl.ok) return dl;
				out.deadline = dl.value;
			}
			if (input['color'] !== undefined) {
				const c = validColor(input['color']);
				if (!c.ok) return c;
				out.color = c.value;
			}
			return { ok: true, value: out };
		}
		case 'item.update': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			const out: Extract<Op, { type: 'item.update' }> = { type: 'item.update', id: id.value };
			if (input['title'] !== undefined) {
				const t = validTitle(input['title'], 'title', LIMITS.titleMax);
				if (!t.ok) return t;
				out.title = t.value;
			}
			if (input['description'] !== undefined) {
				const d = str(input['description'], 'description');
				if (!d.ok) return d;
				if (d.value.length > LIMITS.descriptionMax) {
					return { ok: false, error: `description too long (max ${LIMITS.descriptionMax})` };
				}
				out.description = d.value;
			}
			if (input['deadline'] !== undefined) {
				const dl = validDeadline(input['deadline']);
				if (!dl.ok) return dl;
				out.deadline = dl.value;
			}
			if (input['color'] !== undefined) {
				const c = validColor(input['color']);
				if (!c.ok) return c;
				out.color = c.value;
			}
			return { ok: true, value: out };
		}
		case 'item.move': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			const toColumnId = validId(input['toColumnId'], 'toColumnId');
			if (!toColumnId.ok) return toColumnId;
			const index = validIndex(input['index']);
			if (!index.ok) return index;
			if (index.value === null) return { ok: false, error: 'index is required' };
			return {
				ok: true,
				value: { type: 'item.move', id: id.value, toColumnId: toColumnId.value, index: index.value }
			};
		}
		case 'item.delete': {
			const id = validId(input['id'], 'id');
			if (!id.ok) return id;
			return { ok: true, value: { type: 'item.delete', id: id.value } };
		}
		default:
			return { ok: false, error: `unknown op type: ${String(type).slice(0, 50)}` };
	}
}
