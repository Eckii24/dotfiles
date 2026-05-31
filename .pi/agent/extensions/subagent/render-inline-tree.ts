import { getMarkdownTheme, keyHint } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import {
	aggregateUsage,
	buildDefaultRootSummary,
	formatToolCall,
	formatUsageStats,
	getDisplayItems,
	getFinalOutput,
	getFocusedLeaf,
	getRootStatusLabel,
	getRunStatusIcon,
	getStatusCounts,
	getToolCallItems,
	getToolResultText,
	normalizeSubagentDetails,
	toInlinePreview,
	type LeafRunSnapshot,
	type RootRunSnapshot,
	type ToolCallDisplayItem,
} from "./run-model.js";

type TreeNode = { label: string; children?: TreeNode[] };

function getGroupLabel(root: RootRunSnapshot, theme: any): string {
	const icon = getRunStatusIcon(root.status, theme);
	return `${icon} ${theme.fg("toolTitle", theme.bold(`${root.mode} `))}${theme.fg("accent", getRootStatusLabel(root))}`;
}

function getNestedSubagentRun(item: ToolCallDisplayItem): RootRunSnapshot | undefined {
	if (item.name !== "subagent") return undefined;
	return normalizeSubagentDetails(item.result?.details);
}

function selectToolItemsForTree(items: ToolCallDisplayItem[], expanded: boolean) {
	if (expanded) return { items, omittedCount: 0 };

	const selectedIds = new Set<string>();
	for (const item of items) {
		if (getNestedSubagentRun(item)) selectedIds.add(item.id);
	}

	let remainingRegularItems = 6;
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (selectedIds.has(item.id)) continue;
		if (remainingRegularItems <= 0) break;
		selectedIds.add(item.id);
		remainingRegularItems--;
	}

	const selectedItems = items.filter((item) => selectedIds.has(item.id));
	return { items: selectedItems, omittedCount: Math.max(0, items.length - selectedItems.length) };
}

function buildToolTreeNode(item: ToolCallDisplayItem, expanded: boolean, theme: any): TreeNode {
	const nestedRun = getNestedSubagentRun(item);
	if (nestedRun) {
		if (nestedRun.mode === "single" && nestedRun.children.length === 1) {
			return buildLeafTreeNode(nestedRun.children[0]!, expanded, theme);
		}
		return {
			label: getGroupLabel(nestedRun, theme),
			children: nestedRun.children.map((leaf, index) =>
				buildLeafTreeNode(leaf, expanded, theme, nestedRun.mode === "chain" ? `${leaf.step ?? index + 1}. ` : undefined),
			),
		};
	}

	let label = formatToolCall(item.name, item.args, theme.fg.bind(theme));
	if (!item.result) {
		label += ` ${theme.fg("warning", "⏳")}`;
	} else if (item.result.isError) {
		const preview = toInlinePreview(getToolResultText(item.result) || "tool failed", 100);
		label += ` ${theme.fg("error", "✗")}`;
		if (preview) label += theme.fg("error", ` ${preview}`);
	}

	return { label };
}

function buildLeafTreeNode(leaf: LeafRunSnapshot, expanded: boolean, theme: any, labelPrefix?: string): TreeNode {
	const icon = getRunStatusIcon(leaf.status, theme);
	let label = `${labelPrefix ? theme.fg("muted", labelPrefix) : ""}${icon} ${theme.fg("toolTitle", theme.bold(leaf.agent))}${theme.fg("muted", ` (${leaf.agentSource})`)}`;
	if ((leaf.status === "failed" || leaf.status === "aborted") && leaf.stopReason) {
		label += ` ${theme.fg("error", `[${leaf.stopReason}]`)}`;
	}

	const children: TreeNode[] = [];
	if (expanded && leaf.task.trim()) {
		children.push({ label: theme.fg("muted", "task: ") + theme.fg("dim", toInlinePreview(leaf.task, 180)) });
	}
	if ((leaf.status === "failed" || leaf.status === "aborted") && leaf.errorMessage) {
		children.push({ label: theme.fg("error", `error: ${toInlinePreview(leaf.errorMessage, 180)}`) });
	}

	const toolItems = getToolCallItems(leaf.messages);
	const { items, omittedCount } = selectToolItemsForTree(toolItems, expanded);
	for (const item of items) children.push(buildToolTreeNode(item, expanded, theme));
	if (omittedCount > 0) {
		children.push({ label: theme.fg("muted", `… +${omittedCount} more action${omittedCount === 1 ? "" : "s"}`) });
	}

	const finalOutput = (leaf.finalOutput || getFinalOutput(leaf.messages)).trim();
	if (finalOutput) {
		children.push({
			label: theme.fg("toolOutput", `${leaf.status === "running" ? "latest" : "final"}: ${toInlinePreview(finalOutput, expanded ? 180 : 100)}`),
		});
	}

	if (children.length === 0) {
		children.push({
			label: theme.fg(
				"muted",
				leaf.status === "running" ? "(running...)" : leaf.status === "queued" ? "(queued)" : "(no output)",
			),
		});
	}

	return { label, children };
}

function renderTreeChildren(nodes: TreeNode[], prefix = ""): string[] {
	const lines: string[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		const isLast = i === nodes.length - 1;
		const branchPrefix = prefix + (isLast ? "└─ " : "├─ ");
		lines.push(branchPrefix + node.label);
		if (node.children && node.children.length > 0) {
			lines.push(...renderTreeChildren(node.children, prefix + (isLast ? "   " : "│  ")));
		}
	}
	return lines;
}

export function renderExecutionTree(root: RootRunSnapshot, expanded: boolean, theme: any): string {
	if (root.mode === "single" && root.children.length === 1) {
		const node = buildLeafTreeNode(root.children[0]!, expanded, theme);
		return [node.label, ...renderTreeChildren(node.children ?? [])].join("\n");
	}

	const rootChildren = root.children.map((leaf, index) =>
		buildLeafTreeNode(leaf, expanded, theme, root.mode === "chain" ? `${leaf.step ?? index + 1}. ` : undefined),
	);
	return [getGroupLabel(root, theme), ...renderTreeChildren(rootChildren)].join("\n");
}

function buildCompactResultText(result: any, root: RootRunSnapshot, theme: any): string {
	const summaryFromContent = result.content?.find((item: any) => item?.type === "text")?.text;
	const summary = toInlinePreview(summaryFromContent || root.summaryText || buildDefaultRootSummary(root), 220) || buildDefaultRootSummary(root);
	const meta = root.mode === "single"
		? `${getRunStatusIcon(root.status, theme)} ${theme.fg("muted", "Single subagent")}`
		: `${getRunStatusIcon(root.status, theme)} ${theme.fg("muted", `${root.mode} · ${getRootStatusLabel(root)}`)}`;
	return `${summary}\n${meta}`;
}

function renderLeafDetails(container: Container, leaf: LeafRunSnapshot, theme: any): void {
	const displayItems = getDisplayItems(leaf.messages);
	const finalOutput = leaf.finalOutput || getFinalOutput(leaf.messages);
	const icon = getRunStatusIcon(leaf.status, theme);
	let header = `${icon} ${theme.fg("toolTitle", theme.bold(leaf.agent))}${theme.fg("muted", ` (${leaf.agentSource})`)}`;
	if ((leaf.status === "failed" || leaf.status === "aborted") && leaf.stopReason) {
		header += ` ${theme.fg("error", `[${leaf.stopReason}]`)}`;
	}
	container.addChild(new Text(header, 0, 0));
	if (leaf.errorMessage) container.addChild(new Text(theme.fg("error", `Error: ${leaf.errorMessage}`), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
	container.addChild(new Text(theme.fg("dim", leaf.task), 0, 0));
	container.addChild(new Spacer(1));
	container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
	if (displayItems.length === 0 && !finalOutput) {
		container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
	} else {
		for (const item of displayItems) {
			if (item.type === "toolCall") {
				container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
			}
		}
		if (finalOutput) {
			container.addChild(new Spacer(1));
			container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
		}
	}
	const usageStr = formatUsageStats(leaf.usage, leaf.model);
	if (usageStr) {
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
	}
}

export function renderSubagentResult(result: any, options: { expanded: boolean }, theme: any): Text | Container | Markdown {
	const root = normalizeSubagentDetails(result.details);
	if (!root || root.children.length === 0) {
		const text = result.content?.[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	const treeText = renderExecutionTree(root, options.expanded, theme);
	const expandHint = theme.fg("muted", `(${keyHint("app.tools.expand", "to expand details")})`);
	const statusHint = theme.fg("muted", "(/subagents for active + recent tree details)");

	if (root.mode === "single" && root.children.length === 1) {
		const leaf = root.children[0]!;
		if (options.expanded) {
			const container = new Container();
			container.addChild(new Text(treeText, 0, 0));
			container.addChild(new Spacer(1));
			renderLeafDetails(container, leaf, theme);
			return container;
		}

		let text = buildCompactResultText(result, root, theme);
		const usageStr = formatUsageStats(leaf.usage, leaf.model);
		if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
		text += `\n${statusHint}`;
		text += `\n${expandHint}`;
		return new Text(text, 0, 0);
	}

	if (root.mode === "chain") {
		if (options.expanded) {
			const container = new Container();
			container.addChild(new Text(treeText, 0, 0));
			for (const leaf of root.children) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(`${theme.fg("muted", `─── Step ${leaf.step}: `)}${theme.fg("accent", leaf.agent)} ${getRunStatusIcon(leaf.status, theme)}`, 0, 0));
				container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", leaf.task), 0, 0));
				for (const item of getDisplayItems(leaf.messages)) {
					if (item.type === "toolCall") {
						container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
					}
				}
				const finalOutput = leaf.finalOutput || getFinalOutput(leaf.messages);
				if (finalOutput) {
					container.addChild(new Spacer(1));
					container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
				}
				const stepUsage = formatUsageStats(leaf.usage, leaf.model);
				if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
			}
			const usageStr = formatUsageStats(aggregateUsage(root.children));
			if (usageStr) {
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
			}
			return container;
		}

		let text = buildCompactResultText(result, root, theme);
		const usageStr = formatUsageStats(aggregateUsage(root.children));
		if (usageStr) text += `\n${theme.fg("dim", `Total: ${usageStr}`)}`;
		text += `\n${statusHint}`;
		text += `\n${expandHint}`;
		return new Text(text, 0, 0);
	}

	const counts = getStatusCounts(root);
	const isRunning = counts.running > 0 || counts.queued > 0;
	if (options.expanded && !isRunning) {
		const container = new Container();
		container.addChild(new Text(treeText, 0, 0));
		for (const leaf of root.children) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(`${theme.fg("muted", "─── ")}${theme.fg("accent", leaf.agent)} ${getRunStatusIcon(leaf.status, theme)}`, 0, 0));
			container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", leaf.task), 0, 0));
			for (const item of getDisplayItems(leaf.messages)) {
				if (item.type === "toolCall") {
					container.addChild(new Text(theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)), 0, 0));
				}
			}
			const finalOutput = leaf.finalOutput || getFinalOutput(leaf.messages);
			if (finalOutput) {
				container.addChild(new Spacer(1));
				container.addChild(new Markdown(finalOutput.trim(), 0, 0, getMarkdownTheme()));
			}
			const taskUsage = formatUsageStats(leaf.usage, leaf.model);
			if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
		}
		const usageStr = formatUsageStats(aggregateUsage(root.children));
		if (usageStr) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
		}
		return container;
	}

	let text = options.expanded ? treeText : buildCompactResultText(result, root, theme);
	if (!isRunning) {
		const usageStr = formatUsageStats(aggregateUsage(root.children));
		if (usageStr) text += `\n${theme.fg("dim", `Total: ${usageStr}`)}`;
	}
	text += `\n${statusHint}`;
	if (!options.expanded) text += `\n${expandHint}`;
	return new Text(text, 0, 0);
}

export function getDefaultFocusedLeaf(root: RootRunSnapshot): LeafRunSnapshot | undefined {
	return getFocusedLeaf(root);
}
