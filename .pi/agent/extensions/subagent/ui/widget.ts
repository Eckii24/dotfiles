import { truncateToWidth } from "@mariozechner/pi-tui";
import { flattenRunTree, getRunStatusIcon, isActiveStatus, toInlinePreview, type RunTreeNode, type RunTreeRow } from "../run-model.js";

export const MAX_WIDGET_TOTAL_LINES = 10;
export const MAX_WIDGET_LINE_WIDTH = 108;
export const MIN_WIDGET_LINE_WIDTH = 56;

export interface RunTreeRowFormatOptions {
	maxWidth?: number;
	previewMaxLength?: number;
	showPreview?: boolean;
	showLiveBadge?: boolean;
	showSummary?: boolean;
}

export function resolveWidgetLineWidth(terminalColumns = process.stdout.columns ?? MAX_WIDGET_LINE_WIDTH): number {
	return Math.max(MIN_WIDGET_LINE_WIDTH, Math.min(MAX_WIDGET_LINE_WIDTH, Math.max(MIN_WIDGET_LINE_WIDTH, terminalColumns - 6)));
}

export function buildTreeRowPrefix(row: Pick<RunTreeRow, "depth" | "ancestorIsLast" | "isLastSibling">): string {
	if (row.depth === 0) return "";
	const ancestors = row.ancestorIsLast
		.slice(0, -1)
		.map((isLast) => (isLast ? "   " : "│  "))
		.join("");
	return `${ancestors}${row.isLastSibling ? "└─ " : "├─ "}`;
}

export function formatRunTreeRow(row: RunTreeRow, theme: any, options: number | RunTreeRowFormatOptions = {}): string {
	const resolvedOptions = typeof options === "number" ? { maxWidth: options } : options;
	const prefix = buildTreeRowPrefix(row);
	let text = `${prefix}${getRunStatusIcon(row.status, theme)} ${theme.fg("toolTitle", row.title)}`;
	if ((resolvedOptions.showSummary ?? Boolean(row.summary)) && row.summary) {
		text += theme.fg("muted", ` · ${row.summary}`);
	}
	if ((resolvedOptions.showLiveBadge ?? true) && row.controllable) {
		text += theme.fg("accent", " · live");
	}
	const preview = (resolvedOptions.showPreview ?? shouldShowPreview(row))
		? toInlinePreview(row.preview || "", resolvedOptions.previewMaxLength ?? getDefaultPreviewMaxLength(row))
		: "";
	if (preview) text += theme.fg("dim", ` — ${preview}`);
	return resolvedOptions.maxWidth ? truncateToWidth(text, resolvedOptions.maxWidth) : text;
}

export function buildActiveRunsWidgetLines(
	forest: RunTreeNode[],
	theme: any,
	options: {
		maxWidth?: number;
		totalLineBudget?: number;
	} = {},
): string[] {
	const activeRoots = forest.filter((node) => isActiveStatus(node.status));
	if (activeRoots.length === 0) return [];

	const maxWidth = options.maxWidth ?? resolveWidgetLineWidth();
	const totalLineBudget = Math.max(3, options.totalLineBudget ?? MAX_WIDGET_TOTAL_LINES);
	const lines = [
		truncateToWidth(theme.fg("accent", theme.bold(`Subagents · ${activeRoots.length} active`)), maxWidth),
	];

	const rowQueues = activeRoots.map((root, index) => ({ ordinal: index + 1, rows: [...collectBreadthFirstRows(root)] }));
	const totalRows = rowQueues.reduce((sum, queue) => sum + queue.rows.length, 0);
	const reserveFooter = totalLineBudget >= 3 ? 1 : 0;
	const reserveOmitted = totalRows > totalLineBudget - 1 - reserveFooter ? 1 : 0;
	const rowBudget = Math.max(0, totalLineBudget - 1 - reserveFooter - reserveOmitted);
	const shownRows: Array<{ row: RunTreeRow; ordinal: number }> = [];
	while (shownRows.length < rowBudget && rowQueues.some((queue) => queue.rows.length > 0)) {
		for (const queue of rowQueues) {
			if (shownRows.length >= rowBudget) break;
			const nextRow = queue.rows.shift();
			if (!nextRow) continue;
			shownRows.push({ row: nextRow, ordinal: queue.ordinal });
		}
	}

	for (const { row, ordinal } of shownRows) {
		lines.push(truncateToWidth(formatWidgetRowLine(row, theme, maxWidth, ordinal, activeRoots.length), maxWidth));
	}

	const omitted = rowQueues.reduce((sum, queue) => sum + queue.rows.length, 0);
	if (omitted > 0) lines.push(truncateToWidth(theme.fg("muted", `… +${omitted} more node${omitted === 1 ? "" : "s"}`), maxWidth));
	if (reserveFooter > 0 && lines.length < totalLineBudget) lines.push(truncateToWidth(theme.fg("dim", "/subagents for details"), maxWidth));
	return lines.slice(0, totalLineBudget);
}

function formatWidgetRowLine(
	row: RunTreeRow,
	theme: any,
	maxWidth: number,
	ordinal: number,
	activeRootCount: number,
): string {
	const line = formatRunTreeRow(row, theme, buildWidgetRowFormatOptions(row, maxWidth));
	if (activeRootCount <= 1) return line;
	const prefix = row.depth === 0 ? `${ordinal}. ` : `${ordinal}  `;
	return `${theme.fg("muted", prefix)}${line}`;
}

function buildWidgetRowFormatOptions(row: RunTreeRow, maxWidth: number): RunTreeRowFormatOptions {
	return {
		maxWidth,
		previewMaxLength: getResponsivePreviewMaxLength(row, maxWidth),
		showPreview: shouldShowPreview(row) && maxWidth >= 52,
		showSummary: row.kind === "topLevelRun" ? maxWidth >= 52 : row.depth > 0 && maxWidth >= 92,
	};
}

function shouldShowPreview(row: RunTreeRow): boolean {
	return row.kind === "topLevelLeaf"
		|| row.kind === "nestedLeaf"
		|| (row.kind === "topLevelRun" && isActiveStatus(row.status));
}

function getDefaultPreviewMaxLength(row: RunTreeRow): number {
	switch (row.kind) {
		case "topLevelRun":
			return 36;
		case "nestedRun":
			return 24;
		case "nestedLeaf":
			return 40;
		default:
			return 52;
	}
}

function getResponsivePreviewMaxLength(row: RunTreeRow, maxWidth: number): number {
	const baseLimit = maxWidth < 68 ? 14 : maxWidth < 84 ? 22 : getDefaultPreviewMaxLength(row);
	const depthPenalty = Math.max(0, row.depth - 1) * 6;
	return Math.max(10, Math.min(getDefaultPreviewMaxLength(row), baseLimit - depthPenalty));
}

function collectBreadthFirstRows(root: RunTreeNode): RunTreeRow[] {
	const rowById = new Map(flattenRunTree([root]).map((row) => [row.nodeId, row]));
	const queue: RunTreeNode[] = [root];
	const rows: RunTreeRow[] = [];
	while (queue.length > 0) {
		const node = queue.shift()!;
		const row = rowById.get(node.id);
		if (row) rows.push(row);
		queue.push(...node.children);
	}
	return rows;
}
