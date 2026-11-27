import type { BoardState } from './types';

export const REPORT_SYSTEM_INSTRUCTION =
	'Your client values succinct and direct outputs without extra formatting, warnings, and politeness.';

export const REPORT_POINTS = [
	"A brief rundown of what I'm working on",
	'Advice on what task I should start working on first and why'
];

/** Flatten the board into plain text the model can read. */
export function serializeBoard(board: BoardState): string {
	const columns = [...board.columns].sort((a, b) => a.position - b.position);
	const out: string[] = [];
	for (const col of columns) {
		out.push(`## ${col.title}`);
		const items = board.items
			.filter((i) => i.columnId === col.id)
			.sort((a, b) => a.position - b.position);
		if (items.length === 0) {
			out.push('(empty)');
			continue;
		}
		for (const it of items) {
			out.push(it.deadline ? `- ${it.title} (deadline ${it.deadline})` : `- ${it.title}`);
			const desc = it.description.trim();
			if (desc) out.push(desc);
		}
	}
	return out.join('\n');
}

export function buildReportPrompt(board: BoardState): string {
	return [
		'Here is the current state of my kanban board:',
		'',
		serializeBoard(board),
		'',
		'Write my daily rundown. Address the following points in order, one after another:',
		...REPORT_POINTS.map((p, i) => `${i + 1}. ${p}`)
	].join('\n');
}
