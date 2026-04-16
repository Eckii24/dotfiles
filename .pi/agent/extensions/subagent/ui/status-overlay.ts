import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { flattenRunTree, isActiveStatus, type RunTreeNode, type RunTreeRow } from "../run-model.js";
import { renderRunNodeDetailPane } from "./detail-overlay.js";
import { SubagentUIController } from "./controller.js";
import { formatRunTreeRow } from "./widget.js";

export type StatusOverlayResult =
	| { action: "inspect"; nodeId: string }
	| { action: "steer"; nodeId: string }
	| { action: "abort"; nodeId: string }
	| { action: "close" };

export type StatusOverlaySelection = {
	index: number;
	nodeId: string | undefined;
};

export interface StatusOverlayFrame {
	lines: string[];
	signature: string;
	selectedIndex: number;
	selectedNodeId: string | undefined;
}

export interface StatusOverlayRenderScheduler {
	update(signature: string): boolean;
	markRendered(signature: string): void;
	dispose(): void;
}

export const STATUS_OVERLAY_TOTAL_LINES = 22;
const STATUS_OVERLAY_VISIBLE_RECENT_LIMIT = 8;
const STATUS_OVERLAY_CONTENT_LINES = STATUS_OVERLAY_TOTAL_LINES - 8;
const STATUS_OVERLAY_RENDER_THROTTLE_MS = 90;

export async function openStatusOverlay(
	ctx: ExtensionCommandContext,
	controller: SubagentUIController,
): Promise<StatusOverlayResult> {
	return (
		(await ctx.ui.custom<StatusOverlayResult>(
			(tui, theme, _kb, done) => new StatusOverlayComponent(tui, theme, controller, done),
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: "92%",
					minWidth: 76,
					maxHeight: STATUS_OVERLAY_TOTAL_LINES,
					margin: { left: 1, right: 1, bottom: 1, top: 1 },
				},
			},
		)) ?? { action: "close" }
	);
}

export function resolveStatusOverlaySelection(
	items: ReadonlyArray<RunTreeRow>,
	selectedNodeId?: string,
	fallbackIndex = 0,
): StatusOverlaySelection {
	if (items.length === 0) return { index: 0, nodeId: undefined };
	const clampedFallback = Math.max(0, Math.min(fallbackIndex, items.length - 1));
	const selectedIndex = selectedNodeId ? items.findIndex((item) => item.nodeId === selectedNodeId) : -1;
	const index = selectedIndex >= 0 ? selectedIndex : clampedFallback;
	return { index, nodeId: items[index]?.nodeId };
}

export function resolveStatusOverlayActionForSelection(
	data: string,
	selected: RunTreeRow | undefined,
): StatusOverlayResult | undefined {
	if (matchesKey(data, "escape") || matchesKey(data, "q")) return { action: "close" };
	if (matchesKey(data, "return") || matchesKey(data, "i")) {
		return selected?.nodeId ? { action: "inspect", nodeId: selected.nodeId } : undefined;
	}
	if (matchesKey(data, "s")) {
		return selected?.controllable ? { action: "steer", nodeId: selected.nodeId } : undefined;
	}
	if (matchesKey(data, "x") || matchesKey(data, "a")) {
		return selected?.controllable ? { action: "abort", nodeId: selected.nodeId } : undefined;
	}
	return undefined;
}

export function createStatusOverlayRenderScheduler(
	requestRender: () => void,
	options: {
		throttleMs?: number;
		now?: () => number;
		setTimer?: (callback: () => void, delayMs: number) => any;
		clearTimer?: (timer: any) => void;
	} = {},
): StatusOverlayRenderScheduler {
	const throttleMs = options.throttleMs ?? STATUS_OVERLAY_RENDER_THROTTLE_MS;
	const now = options.now ?? (() => Date.now());
	const setTimer = options.setTimer ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
	const clearTimer = options.clearTimer ?? ((timer: any) => clearTimeout(timer));
	let lastRenderedSignature: string | undefined;
	let pendingSignature: string | undefined;
	let lastRenderRequestAt = Number.NEGATIVE_INFINITY;
	let timer: any;

	const flush = () => {
		timer = undefined;
		const signature = pendingSignature;
		pendingSignature = undefined;
		if (!signature || signature === lastRenderedSignature) return;
		lastRenderRequestAt = now();
		requestRender();
	};

	return {
		update(signature: string): boolean {
			if (signature === lastRenderedSignature || signature === pendingSignature) return false;
			pendingSignature = signature;
			if (timer) return true;
			const delayMs = Math.max(0, throttleMs - Math.max(0, now() - lastRenderRequestAt));
			if (delayMs === 0) {
				flush();
				return true;
			}
			timer = setTimer(flush, delayMs);
			return true;
		},
		markRendered(signature: string): void {
			lastRenderedSignature = signature;
			lastRenderRequestAt = now();
			if (pendingSignature === signature) pendingSignature = undefined;
		},
		dispose(): void {
			if (timer) clearTimer(timer);
			timer = undefined;
			pendingSignature = undefined;
		},
	};
}

export function buildStatusOverlayFrame(options: {
	forest: RunTreeNode[];
	theme: Theme;
	width: number;
	selectedNodeId?: string;
	fallbackIndex?: number;
}): StatusOverlayFrame {
	const innerWidth = Math.max(40, options.width - 2);
	const rows = flattenRunTree(options.forest);
	const selection = resolveStatusOverlaySelection(rows, options.selectedNodeId, options.fallbackIndex ?? 0);
	const selectedRow = rows[selection.index];
	const selectedNode = selectedRow?.node;
	const separatorWidth = 3;
	const treeWidth = resolveTreePaneWidth(innerWidth, separatorWidth);
	const detailWidth = Math.max(32, innerWidth - treeWidth - separatorWidth);
	const treeLines = renderTreePane({
		forest: options.forest,
		theme: options.theme,
		width: treeWidth,
		selectedNodeId: selection.nodeId,
		paneHeight: STATUS_OVERLAY_CONTENT_LINES,
	});
	const detailLines = fitPaneLines(
		renderRunNodeDetailPane(selectedNode, options.theme, detailWidth),
		STATUS_OVERLAY_CONTENT_LINES,
		detailWidth,
		options.theme.fg("dim", "… more details below"),
	);

	const lines: string[] = [];
	lines.push(options.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
	lines.push(wrapOuter(` ${options.theme.fg("accent", options.theme.bold("Subagents"))}`, innerWidth, options.theme));
	lines.push(wrapOuter(` ${options.theme.fg("dim", "Centered tree-first modal. Enter inspects; steer/abort still require a live reachable leaf.")}`, innerWidth, options.theme));
	lines.push(wrapOuter(` ${options.theme.fg("dim", "↑/↓ move • Home/End jump • Enter inspect • S steer • X abort • Esc close")}`, innerWidth, options.theme));
	lines.push(wrapOuter("", innerWidth, options.theme));

	for (let index = 0; index < STATUS_OVERLAY_CONTENT_LINES; index++) {
		const left = padStyledLine(treeLines[index] || "", treeWidth);
		const right = padStyledLine(detailLines[index] || "", detailWidth);
		lines.push(
			options.theme.fg("border", "│")
			+ left
			+ options.theme.fg("border", " │ ")
			+ right
			+ options.theme.fg("border", "│"),
		);
	}

	lines.push(wrapOuter("", innerWidth, options.theme));
	lines.push(wrapOuter(` ${options.theme.fg(selectedRow?.controllable ? "accent" : "dim", selectedRow?.controllable
		? `Enter inspects ${selectedRow.title}; S steers and X aborts while it is live.`
		: "Inspect-only node. Press Enter to open recorded execution details.")}`, innerWidth, options.theme));
	lines.push(options.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
	return {
		lines,
		signature: lines.join("\n"),
		selectedIndex: selection.index,
		selectedNodeId: selection.nodeId,
	};
}

class StatusOverlayComponent {
	private selectedIndex = 0;
	private selectedNodeId: string | undefined;
	private lastRenderWidth = 0;
	private readonly unsubscribe: () => void;
	private readonly renderScheduler: StatusOverlayRenderScheduler;

	constructor(
		private readonly tui: any,
		private readonly theme: Theme,
		private readonly controller: SubagentUIController,
		private readonly done: (result: StatusOverlayResult) => void,
	) {
		this.selectedNodeId = this.controller.getSelectedNodeId();
		this.reconcileSelection(this.getRows());
		this.renderScheduler = createStatusOverlayRenderScheduler(() => this.tui.requestRender());
		this.unsubscribe = this.controller.subscribe(() => this.handleControllerUpdate());
	}

	handleInput(data: string): void {
		const rows = this.getRows();
		const action = resolveStatusOverlayActionForSelection(data, this.getSelectedRow(rows));
		if (action) {
			this.done(action);
			return;
		}
		if (matchesKey(data, "up")) {
			this.moveSelection(rows, -1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.moveSelection(rows, 1);
			return;
		}
		if (matchesKey(data, "home")) {
			this.jumpSelection(rows, 0);
			return;
		}
		if (matchesKey(data, "end")) {
			this.jumpSelection(rows, Math.max(0, rows.length - 1));
			return;
		}
	}

	render(width: number): string[] {
		this.lastRenderWidth = width;
		const frame = buildStatusOverlayFrame({
			forest: this.controller.getVisibleForest(STATUS_OVERLAY_VISIBLE_RECENT_LIMIT),
			theme: this.theme,
			width,
			selectedNodeId: this.selectedNodeId,
			fallbackIndex: this.selectedIndex,
		});
		this.selectedIndex = frame.selectedIndex;
		this.selectedNodeId = frame.selectedNodeId;
		this.controller.setSelectedNodeId(frame.selectedNodeId);
		this.renderScheduler.markRendered(frame.signature);
		return frame.lines;
	}

	invalidate(): void {}

	dispose(): void {
		this.unsubscribe();
		this.renderScheduler.dispose();
	}

	private getRows(): RunTreeRow[] {
		return flattenRunTree(this.controller.getVisibleForest(STATUS_OVERLAY_VISIBLE_RECENT_LIMIT));
	}

	private getSelectedRow(rows: RunTreeRow[]): RunTreeRow | undefined {
		const selection = resolveStatusOverlaySelection(rows, this.selectedNodeId, this.selectedIndex);
		return rows[selection.index];
	}

	private moveSelection(rows: RunTreeRow[], delta: number): void {
		if (rows.length === 0) {
			this.selectedIndex = 0;
			this.selectedNodeId = undefined;
			this.controller.setSelectedNodeId(undefined);
			this.tui.requestRender();
			return;
		}
		const selection = resolveStatusOverlaySelection(rows, this.selectedNodeId, this.selectedIndex);
		const nextIndex = Math.max(0, Math.min(rows.length - 1, selection.index + delta));
		this.setSelection(rows[nextIndex]?.nodeId, nextIndex);
	}

	private jumpSelection(rows: RunTreeRow[], index: number): void {
		if (rows.length === 0) return;
		const nextIndex = Math.max(0, Math.min(rows.length - 1, index));
		this.setSelection(rows[nextIndex]?.nodeId, nextIndex);
	}

	private setSelection(nodeId: string | undefined, index: number): void {
		this.selectedIndex = index;
		this.selectedNodeId = nodeId;
		this.controller.setSelectedNodeId(nodeId);
		this.tui.requestRender();
	}

	private reconcileSelection(rows: RunTreeRow[]): void {
		const selection = resolveStatusOverlaySelection(rows, this.selectedNodeId, this.selectedIndex);
		this.selectedIndex = selection.index;
		this.selectedNodeId = selection.nodeId;
		this.controller.setSelectedNodeId(selection.nodeId);
	}

	private handleControllerUpdate(): void {
		const rows = this.getRows();
		this.reconcileSelection(rows);
		if (this.lastRenderWidth <= 0) {
			this.tui.requestRender();
			return;
		}
		const frame = buildStatusOverlayFrame({
			forest: this.controller.getVisibleForest(STATUS_OVERLAY_VISIBLE_RECENT_LIMIT),
			theme: this.theme,
			width: this.lastRenderWidth,
			selectedNodeId: this.selectedNodeId,
			fallbackIndex: this.selectedIndex,
		});
		this.selectedIndex = frame.selectedIndex;
		this.selectedNodeId = frame.selectedNodeId;
		this.controller.setSelectedNodeId(frame.selectedNodeId);
		this.renderScheduler.update(frame.signature);
	}
}

function resolveTreePaneWidth(innerWidth: number, separatorWidth: number): number {
	const preferredWidth = innerWidth < 96
		? Math.floor(innerWidth * 0.46)
		: innerWidth < 124
			? Math.floor(innerWidth * 0.42)
			: Math.floor(innerWidth * 0.38);
	return Math.max(28, Math.min(46, Math.min(preferredWidth, innerWidth - separatorWidth - 32)));
}

function renderTreePane(options: {
	forest: RunTreeNode[];
	theme: Theme;
	width: number;
	selectedNodeId?: string;
	paneHeight: number;
}): string[] {
	const activeRoots = options.forest.filter((node) => isActiveStatus(node.status));
	const recentRoots = options.forest.filter((node) => !isActiveStatus(node.status));
	const activeRows = flattenRunTree(activeRoots);
	const recentRows = flattenRunTree(recentRoots);
	const headerLines = [
		options.theme.fg("accent", options.theme.bold("Tree")),
		options.theme.fg("dim", `${activeRoots.length} active · ${recentRoots.length} recent`),
		"",
	];
	const bodyHeight = Math.max(0, options.paneHeight - headerLines.length);
	const bodyLines = [
		{ text: options.theme.fg("muted", "Active") },
		...renderTreeBodyRows(activeRows, options.width, options.selectedNodeId, options.theme, activeRows.length === 0),
		{ text: "" },
		{ text: options.theme.fg("muted", "Recent") },
		...renderTreeBodyRows(recentRows, options.width, options.selectedNodeId, options.theme, recentRows.length === 0),
	];
	return [...headerLines, ...fitScrollableTreeBody(bodyLines, bodyHeight, options.selectedNodeId, options.width, options.theme)];
}

function renderTreeBodyRows(
	rows: RunTreeRow[],
	width: number,
	selectedNodeId: string | undefined,
	theme: Theme,
	showNone: boolean,
): Array<{ text: string; nodeId?: string }> {
	if (showNone) return [{ text: theme.fg("dim", "(none)") }];
	return rows.map((row) => ({
		text: formatRunTreeRow(row, theme, {
			maxWidth: width,
			previewMaxLength: row.depth >= 2 ? 16 : width < 36 ? 12 : row.kind === "topLevelRun" || row.kind === "nestedRun" ? 22 : 26,
			showSummary: row.depth === 0 && width >= 34,
			showPreview: width >= 30,
			showLiveBadge: width >= 34,
		}),
		nodeId: row.nodeId === selectedNodeId ? row.nodeId : row.nodeId,
	}));
}

function fitScrollableTreeBody(
	lines: Array<{ text: string; nodeId?: string }>,
	height: number,
	selectedNodeId: string | undefined,
	width: number,
	theme: Theme,
): string[] {
	if (height <= 0) return [];
	if (lines.length <= height) return padTreePaneLines(lines, height, width, selectedNodeId, theme);
	const selectedIndex = Math.max(0, lines.findIndex((line) => line.nodeId === selectedNodeId));
	let start = Math.max(0, selectedIndex - Math.floor(height / 3));
	start = Math.min(start, lines.length - height);
	const visible = lines.slice(start, start + height);
	if (start > 0) visible[0] = { text: theme.fg("dim", "↑ earlier nodes") };
	if (start + height < lines.length) visible[visible.length - 1] = { text: theme.fg("dim", "↓ more nodes") };
	return padTreePaneLines(visible, height, width, selectedNodeId, theme);
}

function padTreePaneLines(
	lines: Array<{ text: string; nodeId?: string }>,
	height: number,
	width: number,
	selectedNodeId: string | undefined,
	theme: Theme,
): string[] {
	const rendered = lines.slice(0, height).map((line) => {
		const text = padStyledLine(truncateToWidth(line.text, width), width);
		return line.nodeId === selectedNodeId ? theme.bg("selectedBg", text) : text;
	});
	while (rendered.length < height) rendered.push(" ".repeat(width));
	return rendered;
}

function fitPaneLines(lines: string[], height: number, width: number, overflowLine: string): string[] {
	if (height <= 0) return [];
	const fitted = lines.map((line) => truncateToWidth(line, width));
	if (fitted.length > height) {
		const clipped = fitted.slice(0, height);
		clipped[clipped.length - 1] = truncateToWidth(overflowLine, width);
		return clipped;
	}
	while (fitted.length < height) fitted.push(" ".repeat(width));
	return fitted;
}

function wrapOuter(content: string, innerWidth: number, theme: Theme): string {
	return theme.fg("border", "│") + padStyledLine(truncateToWidth(content, innerWidth), innerWidth) + theme.fg("border", "│");
}

function padStyledLine(content: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(content));
	return content + " ".repeat(padding);
}
