import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
	formatToolCall,
	getDisplayItems,
	getLeafPreview,
	getLeafTreeTitle,
	getRootPreview,
	getRootStatusLabel,
	getRunStatusIcon,
	getRunTreeNodeActionHint,
	getStatusCounts,
	getToolResultText,
	normalizeSubagentDetails,
	toInlinePreview,
	type LeafRunSnapshot,
	type RootRunSnapshot,
	type RunTreeNode,
} from "../run-model.js";
import { SubagentUIController } from "./controller.js";

const MAX_TIMELINE_LINES = 14;
const MAX_CHILDREN_OVERVIEW = 8;
const EXECUTION_DETAIL_OVERLAY_TOTAL_LINES = 24;
const EXECUTION_DETAIL_OVERLAY_CONTENT_LINES = EXECUTION_DETAIL_OVERLAY_TOTAL_LINES - 5;

interface RunNodeDetailRenderOptions {
	maxChildrenOverview: number;
	maxTimelineLines: number;
	showTaskBlock: boolean;
	showOutputBlocks: boolean;
}

const COMPACT_DETAIL_OPTIONS: RunNodeDetailRenderOptions = {
	maxChildrenOverview: MAX_CHILDREN_OVERVIEW,
	maxTimelineLines: MAX_TIMELINE_LINES,
	showTaskBlock: false,
	showOutputBlocks: false,
};

const FULL_DETAIL_OPTIONS: RunNodeDetailRenderOptions = {
	maxChildrenOverview: Number.POSITIVE_INFINITY,
	maxTimelineLines: Number.POSITIVE_INFINITY,
	showTaskBlock: true,
	showOutputBlocks: true,
};

export function renderRunNodeDetailPane(node: RunTreeNode | undefined, theme: Theme, width: number): string[] {
	return buildRunNodeDetailLines(node, theme, width, "Details", COMPACT_DETAIL_OPTIONS);
}

export function renderRunNodeExecutionLines(node: RunTreeNode | undefined, theme: Theme, width: number): string[] {
	return buildRunNodeDetailLines(node, theme, width, "Execution", FULL_DETAIL_OPTIONS);
}

export async function openRunNodeExecutionOverlay(
	ctx: ExtensionCommandContext,
	controller: SubagentUIController,
	nodeId: string,
	initialNode?: RunTreeNode,
): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => new RunNodeExecutionOverlayComponent(tui, theme, controller, nodeId, initialNode, done),
		{
			overlay: true,
			overlayOptions: {
				anchor: "bottom-center",
				width: "92%",
				minWidth: 76,
				maxHeight: EXECUTION_DETAIL_OVERLAY_TOTAL_LINES,
				margin: { left: 1, right: 1, bottom: 1, top: 1 },
			},
		},
	);
}

function buildRunNodeDetailLines(
	node: RunTreeNode | undefined,
	theme: Theme,
	width: number,
	title: string,
	options: RunNodeDetailRenderOptions,
): string[] {
	if (!node) {
		return [
			theme.fg("accent", theme.bold(title)),
			theme.fg("dim", "Select a subagent tree node to inspect it here."),
		];
	}

	const lines: string[] = [theme.fg("accent", theme.bold(title))];
	const addLine = (text = "") => lines.push(truncateToWidth(text, width));
	const addSection = (sectionTitle: string) => {
		if (lines.at(-1) !== "") lines.push("");
		addLine(theme.fg("muted", `─── ${sectionTitle} ───`));
	};

	const preview = node.root ? getRootPreview(node.root, Math.max(40, width - 10)) : node.leaf ? getLeafPreview(node.leaf, Math.max(40, width - 10)) : node.preview;
	addLine(`${getRunStatusIcon(node.status, theme)} ${theme.fg("toolTitle", theme.bold(node.title))}`);
	if (node.summary) addLine(theme.fg("muted", node.summary));
	addLine(theme.fg("dim", `Path: ${node.breadcrumb.join(" › ")}`));
	if (preview) addLine(theme.fg("toolOutput", `Preview: ${preview}`));
	addLine(theme.fg(node.controllable ? "accent" : "dim", `Interaction: ${getRunTreeNodeActionHint(node)}`));
	addLine(theme.fg("dim", `Relation: ${describeRelation(node)}`));

	if (node.root) renderRootDetails(lines, node.root, theme, width, addSection, addLine, options);
	if (node.leaf) renderLeafDetails(lines, node.leaf, theme, width, addSection, addLine, options);
	return lines;
}

function renderRootDetails(
	lines: string[],
	root: RootRunSnapshot,
	theme: Theme,
	width: number,
	addSection: (title: string) => void,
	addLine: (text?: string) => void,
	options: RunNodeDetailRenderOptions,
): void {
	addSection("Run");
	addLine(theme.fg("dim", `Mode: ${root.mode}`));
	if (root.mode !== "single") addLine(theme.fg("dim", `Summary: ${getRootStatusLabel(root)}`));
	if (root.agentScope || root.projectAgentsDir) {
		addLine(theme.fg("dim", `Scope: ${root.agentScope}${root.projectAgentsDir ? ` · ${root.projectAgentsDir}` : ""}`));
	}
	const counts = getStatusCounts(root);
	const countsText = [`${counts.running} running`, `${counts.queued} queued`, `${counts.succeeded} succeeded`, `${counts.failed} failed`, `${counts.aborted} aborted`]
		.filter((entry) => !entry.startsWith("0 "))
		.join(" · ");
	addLine(theme.fg("dim", `Children: ${root.children.length}${countsText ? ` · ${countsText}` : ""}`));
	if (root.summaryText) addLine(theme.fg("toolOutput", `Summary text: ${toInlinePreview(root.summaryText, Math.max(32, width - 16))}`));
	if (root.latestActivity) addLine(theme.fg("dim", `Latest: ${toInlinePreview(root.latestActivity, Math.max(32, width - 10))}`));

	addSection("Direct children");
	if (root.children.length === 0) {
		addLine(theme.fg("dim", "(none)"));
		return;
	}
	const visibleChildren = Number.isFinite(options.maxChildrenOverview)
		? root.children.slice(0, options.maxChildrenOverview)
		: root.children;
	for (const leaf of visibleChildren) {
		let line = `${getRunStatusIcon(leaf.status, theme)} ${theme.fg("toolTitle", getLeafTreeTitle(leaf))}`;
		const preview = getLeafPreview(leaf, Math.max(24, width - 18));
		if (preview) line += theme.fg("dim", ` — ${preview}`);
		addLine(line);
	}
	if (Number.isFinite(options.maxChildrenOverview) && root.children.length > options.maxChildrenOverview) {
		const omitted = root.children.length - options.maxChildrenOverview;
		addLine(theme.fg("muted", `… +${omitted} more child${omitted === 1 ? "" : "ren"}`));
	}

	if (!options.showTaskBlock && !options.showOutputBlocks) return;
	addSection("Child execution details");
	for (const leaf of root.children) {
		addLine(`${getRunStatusIcon(leaf.status, theme)} ${theme.fg("toolTitle", theme.bold(getLeafTreeTitle(leaf)))}`);
		addLine(theme.fg("dim", `Agent: ${leaf.agent}${leaf.agentSource ? ` · ${leaf.agentSource}` : ""}`));
		addLine(theme.fg("dim", `Task: ${toInlinePreview(leaf.task, Math.max(32, width - 8))}`));
		if (options.showTaskBlock) addMultilineBlock(leaf.task, theme, width, addLine, "dim");
		if (leaf.finalOutput) {
			addLine(theme.fg("toolOutput", `Final: ${toInlinePreview(leaf.finalOutput, Math.max(32, width - 9))}`));
			if (options.showOutputBlocks) addMultilineBlock(leaf.finalOutput, theme, width, addLine, "toolOutput");
		} else if (leaf.latestActivity) {
			addLine(theme.fg("dim", `Latest: ${toInlinePreview(leaf.latestActivity, Math.max(32, width - 10))}`));
		}
		if (leaf.errorMessage) addLine(theme.fg("error", `Error: ${toInlinePreview(leaf.errorMessage, Math.max(32, width - 9))}`));
		if (leaf.stderr) addLine(theme.fg("error", `stderr: ${toInlinePreview(leaf.stderr, Math.max(32, width - 10))}`));
		const timelineLines = buildTimelineLines(leaf, theme, width, 6);
		if (timelineLines.length > 0) {
			for (const timelineLine of timelineLines) addLine(timelineLine);
		}
		if (leaf !== root.children.at(-1)) addLine();
	}
}

function renderLeafDetails(
	lines: string[],
	leaf: LeafRunSnapshot,
	theme: Theme,
	width: number,
	addSection: (title: string) => void,
	addLine: (text?: string) => void,
	options: RunNodeDetailRenderOptions,
): void {
	addSection("Leaf");
	addLine(theme.fg("dim", `Agent: ${leaf.agent}${leaf.agentSource ? ` · ${leaf.agentSource}` : ""}`));
	if (leaf.step) addLine(theme.fg("dim", `Step: ${leaf.step}`));
	addLine(theme.fg("dim", `Task: ${toInlinePreview(leaf.task, Math.max(32, width - 8))}`));
	if (leaf.latestActivity) addLine(theme.fg("dim", `Latest: ${toInlinePreview(leaf.latestActivity, Math.max(32, width - 10))}`));
	if (leaf.finalOutput) addLine(theme.fg("toolOutput", `Final: ${toInlinePreview(leaf.finalOutput, Math.max(32, width - 9))}`));
	if (leaf.errorMessage) addLine(theme.fg("error", `Error: ${toInlinePreview(leaf.errorMessage, Math.max(32, width - 9))}`));
	if (leaf.stderr) addLine(theme.fg("error", `stderr: ${toInlinePreview(leaf.stderr, Math.max(32, width - 10))}`));

	if (options.showTaskBlock) {
		addSection("Task body");
		addMultilineBlock(leaf.task, theme, width, addLine, "dim");
	}

	if (options.showOutputBlocks && leaf.finalOutput) {
		addSection("Final output");
		addMultilineBlock(leaf.finalOutput, theme, width, addLine, "toolOutput");
	}
	if (options.showOutputBlocks && leaf.stderr) {
		addSection("stderr");
		addMultilineBlock(leaf.stderr, theme, width, addLine, "error");
	}
	if (options.showOutputBlocks && leaf.errorMessage) {
		addSection("Error body");
		addMultilineBlock(leaf.errorMessage, theme, width, addLine, "error");
	}

	const steeringLines = buildSteeringLines(leaf, theme, width);
	if (steeringLines.length > 0) {
		addSection("Steering");
		for (const line of steeringLines) addLine(line);
	}

	addSection("Timeline");
	for (const line of buildTimelineLines(leaf, theme, width, options.maxTimelineLines)) addLine(line);
}

function describeRelation(node: RunTreeNode): string {
	const parent = node.breadcrumb.length > 1 ? node.breadcrumb.at(-2) : undefined;
	return `${parent ? `child of ${parent}` : "top-level root"} · ${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
}

function addMultilineBlock(
	text: string,
	theme: Theme,
	width: number,
	addLine: (text?: string) => void,
	color: "dim" | "toolOutput" | "error",
): void {
	const lines = text.replace(/\r/g, "").split("\n");
	if (lines.length === 0) {
		addLine(theme.fg("dim", "(empty)"));
		return;
	}
	for (const line of lines) {
		addLine(theme.fg(color, line.length > 0 ? line : " "));
	}
}

function getExecutionNodeUpdateSignature(node: RunTreeNode | undefined): string | undefined {
	return node ? JSON.stringify(node) : undefined;
}

function mergeExecutionNodeSnapshot(previous: RunTreeNode | undefined, next: RunTreeNode | undefined): RunTreeNode | undefined {
	if (!previous) return next ? structuredClone(next) : undefined;
	if (!next) return structuredClone(previous);
	const merged = structuredClone(next);
	const previousLeaf = previous.leaf;
	const mergedLeaf = merged.leaf;
	if (previousLeaf && mergedLeaf) {
		merged.leaf = mergeLeafSnapshot(previousLeaf, mergedLeaf);
	}
	const previousRoot = previous.root;
	const mergedRoot = merged.root;
	if (previousRoot && mergedRoot) {
		const previousChildrenById = new Map(previousRoot.children.map((child) => [child.id, child]));
		merged.root = {
			...mergedRoot,
			children: mergedRoot.children.map((child) => mergeLeafSnapshot(previousChildrenById.get(child.id), child)),
		};
	}
	const previousChildrenById = new Map(previous.children.map((child) => [child.id, child]));
	merged.children = merged.children.map((child) => mergeExecutionNodeSnapshot(previousChildrenById.get(child.id), child) ?? child);
	return merged;
}

function mergeLeafSnapshot(previous: LeafRunSnapshot | undefined, next: LeafRunSnapshot): LeafRunSnapshot {
	if (!previous) return structuredClone(next);
	const merged = structuredClone(next);
	const previousMessages = JSON.stringify(previous.messages);
	const nextMessages = JSON.stringify(merged.messages);
	if (previousMessages.length > nextMessages.length) merged.messages = structuredClone(previous.messages);
	if (!merged.finalOutput && previous.finalOutput) merged.finalOutput = previous.finalOutput;
	if (!merged.errorMessage && previous.errorMessage) merged.errorMessage = previous.errorMessage;
	if (!merged.stderr && previous.stderr) merged.stderr = previous.stderr;
	return merged;
}

function buildTimelineLines(leaf: LeafRunSnapshot, theme: Theme, width: number, maxLines = MAX_TIMELINE_LINES): string[] {
	const lines: string[] = [];
	for (const item of getDisplayItems(leaf.messages)) {
		if (item.type === "text") {
			const preview = toInlinePreview(item.text, Math.max(24, width - 4));
			if (preview) lines.push(theme.fg("toolOutput", truncateToWidth(preview, width)));
			continue;
		}

		const nestedRun = normalizeSubagentDetails(item.result?.details);
		if (nestedRun) {
			lines.push(theme.fg("accent", truncateToWidth(`${getRunStatusIcon(nestedRun.status, theme)} ${nestedRun.mode} subagent${nestedRun.latestActivity ? ` — ${nestedRun.latestActivity}` : ""}`, width)));
			continue;
		}

		const toolLine = truncateToWidth(formatToolCall(item.name, item.args, theme.fg.bind(theme)), width);
		lines.push(toolLine);
		const resultText = toInlinePreview(getToolResultText(item.result), Math.max(24, width - 6));
		if (resultText) {
			const prefix = item.result?.isError ? "↳ error: " : "↳ ";
			const color = item.result?.isError ? "error" : "dim";
			lines.push(theme.fg(color, truncateToWidth(`${prefix}${resultText}`, width)));
		}
	}

	if (leaf.finalOutput) {
		lines.push(theme.fg("success", truncateToWidth(`final: ${toInlinePreview(leaf.finalOutput, Math.max(30, width - 7))}`, width)));
	}
	if (leaf.errorMessage) {
		lines.push(theme.fg("error", truncateToWidth(`error: ${leaf.errorMessage}`, width)));
	}
	if (lines.length === 0) lines.push(theme.fg("dim", "(no timeline yet)"));
	return Number.isFinite(maxLines) ? lines.slice(-maxLines) : lines;
}

class RunNodeExecutionOverlayComponent {
	private scrollOffset = 0;
	private contentLines: string[] = [];
	private lastKnownNode: RunTreeNode | undefined;
	private lastKnownSignature: string | undefined;
	private readonly unsubscribe: () => void;

	constructor(
		private readonly tui: any,
		private readonly theme: Theme,
		private readonly controller: SubagentUIController,
		private readonly nodeId: string,
		initialNode: RunTreeNode | undefined,
		private readonly done: () => void,
	) {
		this.lastKnownNode = mergeExecutionNodeSnapshot(initialNode, this.controller.getAnyNode(this.nodeId) ?? this.controller.getNode(this.nodeId));
		this.lastKnownSignature = getExecutionNodeUpdateSignature(this.lastKnownNode);
		this.unsubscribe = this.controller.subscribe(() => {
			const nextNode = mergeExecutionNodeSnapshot(this.lastKnownNode, this.controller.getAnyNode(this.nodeId));
			const nextSignature = getExecutionNodeUpdateSignature(nextNode);
			if (nextSignature === this.lastKnownSignature) return;
			this.lastKnownNode = nextNode;
			this.lastKnownSignature = nextSignature;
			this.tui.requestRender();
		});
	}

	handleInput(data: string): void {
		const maxOffset = Math.max(0, this.contentLines.length - EXECUTION_DETAIL_OVERLAY_CONTENT_LINES);
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "return")) {
			this.done();
			return;
		}
		if (matchesKey(data, "up")) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "down")) {
			this.scrollOffset = Math.min(maxOffset, this.scrollOffset + 1);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "end")) {
			this.scrollOffset = maxOffset;
			this.tui.requestRender();
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(40, width - 2);
		const node = mergeExecutionNodeSnapshot(this.lastKnownNode, this.controller.getAnyNode(this.nodeId)) ?? this.lastKnownNode;
		if (node) {
			this.lastKnownNode = node;
			this.lastKnownSignature = getExecutionNodeUpdateSignature(node);
		}
		this.contentLines = renderRunNodeExecutionLines(node, this.theme, innerWidth);
		const maxOffset = Math.max(0, this.contentLines.length - EXECUTION_DETAIL_OVERLAY_CONTENT_LINES);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		const visibleLines = this.contentLines.slice(this.scrollOffset, this.scrollOffset + EXECUTION_DETAIL_OVERLAY_CONTENT_LINES);
		const above = this.scrollOffset;
		const below = Math.max(0, this.contentLines.length - EXECUTION_DETAIL_OVERLAY_CONTENT_LINES - this.scrollOffset);
		const lines: string[] = [];
		lines.push(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
		lines.push(wrapExecutionOverlayLine(` ${this.theme.fg("accent", this.theme.bold(`Execution · ${node?.title ?? "Unavailable node"}`))}`, innerWidth, this.theme));
		lines.push(wrapExecutionOverlayLine(` ${this.theme.fg("dim", `↑/↓ scroll • Home/End jump • Enter/Esc back${maxOffset > 0 ? ` • ↑${above} ↓${below}` : ""}`)}`, innerWidth, this.theme));
		for (let index = 0; index < EXECUTION_DETAIL_OVERLAY_CONTENT_LINES; index++) {
			lines.push(wrapExecutionOverlayLine(visibleLines[index] || "", innerWidth, this.theme));
		}
		lines.push(wrapExecutionOverlayLine(` ${this.theme.fg("dim", `Showing ${Math.min(this.contentLines.length, this.scrollOffset + 1)}-${Math.min(this.contentLines.length, this.scrollOffset + EXECUTION_DETAIL_OVERLAY_CONTENT_LINES)} of ${this.contentLines.length}`)}`, innerWidth, this.theme));
		lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {
		this.unsubscribe();
	}
}

function wrapExecutionOverlayLine(content: string, innerWidth: number, theme: Theme): string {
	return theme.fg("border", "│") + padStyledLine(truncateToWidth(content, innerWidth), innerWidth) + theme.fg("border", "│");
}

function padStyledLine(content: string, width: number): string {
	const padding = Math.max(0, width - visibleWidth(content));
	return content + " ".repeat(padding);
}

function buildSteeringLines(leaf: LeafRunSnapshot, theme: Theme, width: number): string[] {
	const lines: string[] = [];
	for (const queued of leaf.queue.steering) {
		lines.push(theme.fg("warning", truncateToWidth(`queued steer: ${toInlinePreview(queued, width - 14)}`, width)));
	}
	for (const queued of leaf.queue.followUp) {
		lines.push(theme.fg("warning", truncateToWidth(`queued follow-up: ${toInlinePreview(queued, width - 18)}`, width)));
	}
	for (const item of leaf.steeringHistory.slice(-4)) {
		const prefix = item.status === "failed" ? "failed" : item.status === "sent" ? "sent" : "queued";
		const color = item.status === "failed" ? "error" : item.status === "sent" ? "success" : "warning";
		lines.push(theme.fg(color, truncateToWidth(`${prefix}: ${toInlinePreview(item.text, width - prefix.length - 2)}`, width)));
		if (item.error) lines.push(theme.fg("error", truncateToWidth(`  ${item.error}`, width)));
	}
	return lines.slice(-8);
}
