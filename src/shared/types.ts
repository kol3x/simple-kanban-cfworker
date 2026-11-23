/** Item color = palette id ('none' sentinel = uncolored); the palette itself is
 *  dynamic board data (see ColorDef), so there is no fixed enum anymore. */
export type Color = string;

export const DEFAULT_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
	{ id: 'gray', hex: '#8b8f99' },
	{ id: 'red', hex: '#e5697e' },
	{ id: 'orange', hex: '#eb9645' },
	{ id: 'yellow', hex: '#e3c53f' },
	{ id: 'green', hex: '#4cc38a' },
	{ id: 'teal', hex: '#3fc4b0' },
	{ id: 'blue', hex: '#6ea8fe' },
	{ id: 'purple', hex: '#a07ef0' },
	{ id: 'magenta', hex: '#e569cf' }
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
}

export interface ItemState {
	id: string;
	columnId: string;
	position: number;
	title: string;
	description: string;
	/** ISO date `YYYY-MM-DD` or null */
	deadline: string | null;
	color: Color;
	createdAt: number;
	updatedAt: number;
}

export interface BoardState {
	colors: ColorDef[];
	columns: ColumnState[];
	items: ItemState[];
}

export type Op =
	| { type: 'color.update'; id: string; name?: string; hex?: string }
	| { type: 'color.create'; id?: string; name: string; hex: string }
	| { type: 'column.create'; title: string }
	| { type: 'column.rename'; id: string; title: string }
	| { type: 'column.toggleCollapse'; id: string }
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
