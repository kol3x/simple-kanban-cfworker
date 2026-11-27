/** Item color = palette id ('none' sentinel = uncolored); the palette itself is
 *  dynamic board data (see ColorDef), so there is no fixed enum anymore. */
export type Color = string;

export const DEFAULT_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
	{ id: 'gray', hex: '#a3adbf' },
	{ id: 'red', hex: '#ff6b81' },
	{ id: 'orange', hex: '#ff9066' },
	{ id: 'yellow', hex: '#ffd93d' },
	{ id: 'green', hex: '#5ce27e' },
	{ id: 'teal', hex: '#3fe0c0' },
	{ id: 'blue', hex: '#38b6ff' },
	{ id: 'purple', hex: '#b07aff' },
	{ id: 'magenta', hex: '#ff6fd8' }
];

/** A palette entry. Identity is the id (originally the color value); the name is
 *  a user-editable label, the hex is the rendered color. 'none' is a sentinel for
 *  uncolored items and is not part of the palette. */
export interface ColorDef {
	id: string;
	name: string;
	hex: string;
}

export interface ColumnState {
	id: string;
	title: string;
	position: number;
	collapsed: boolean;
	/** group items by the day they landed in this column (e.g. a Done log) */
	dateGrouped: boolean;
}

export interface ItemState {
	id: string;
	columnId: string;
	position: number;
	title: string;
	description: string;
	/** ISO date `YYYY-MM-DD` or null */
	deadline: string | null;
	/** day the item landed in a date-grouped column (UTC `YYYY-MM-DD`), null elsewhere */
	doneDate: string | null;
	color: Color;
	createdAt: number;
	updatedAt: number;
}

export interface BoardState {
	colors: ColorDef[];
	columns: ColumnState[];
	items: ItemState[];
}

/** Daily AI-generated rundown. `day` is the UTC date it was generated for. */
export interface Report {
	day: string;
	content: string;
	generatedAt: number;
}

export type Op =
	| { type: 'color.update'; id: string; name?: string; hex?: string }
	| { type: 'color.create'; id?: string; name: string; hex: string }
	| { type: 'column.create'; title: string }
	| { type: 'column.rename'; id: string; title: string }
	| { type: 'column.toggleCollapse'; id: string }
	| { type: 'column.setDateGrouped'; id: string; value: boolean }
	| { type: 'column.delete'; id: string }
	| {
			type: 'item.create';
			columnId: string;
			title: string;
			index?: number;
			description?: string;
			deadline?: string | null;
			color?: Color;
	  }
	| {
			type: 'item.update';
			id: string;
			title?: string;
			description?: string;
			deadline?: string | null;
			color?: Color;
	  }
	| { type: 'item.move'; id: string; toColumnId: string; index: number }
	| { type: 'item.delete'; id: string };
