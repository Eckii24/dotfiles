import { tableDataCells, tableHeaders } from "./render.js";
import type { GroupBy, SortOrder, UsageSort } from "./types.js";
import type { UsageEvent } from "./session-reader.js";

export interface TreeNode {
	key: string;
	label: string;
	cost: number;
	costInput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costOutput: number;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	reasoning: number;
	turns: number;
	uniqueSessions: number;
	cacheReadRate?: number;
	children: TreeNode[];
}

type InternalTreeNode = TreeNode & { sessionIds: Set<string> };
const sessions = new WeakMap<TreeNode, Set<string>>();

function value(event: UsageEvent, group: GroupBy): string {
	if (group === "day") { const d = new Date(event.timestampMs); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
	if (group === "model") return `${event.provider}/${event.model}`;
	if (group === "session") return event.sessionTitle || event.sessionId;
	if (group === "thread") return event.threadTitle || event.threadId;
	if (group === "project") return event.project;
	if (group === "workflow") return event.workflow;
	return event.agentName;
}

function score(node: TreeNode, sort: UsageSort): number {
	if (sort === "cost") return node.cost;
	if (sort === "turns") return node.turns;
	if (sort === "tokens") return node.input + node.cacheRead + node.cacheWrite + node.output;
	if (sort === "cache-rate") { const prompt = node.input + node.cacheRead + node.cacheWrite; return prompt ? node.cacheRead / prompt : -1; }
	return 0;
}

export function usageTree(events: UsageEvent[], startMs: number, endMs: number, groups: GroupBy[], sort: UsageSort = "cost", order: SortOrder = "desc"): TreeNode[] {
	const selected = events.filter((event) => event.timestampMs >= startMs && event.timestampMs < endMs);
	const root = new Map<string, InternalTreeNode>();
	for (const event of selected) {
		let map = root;
		let parent: InternalTreeNode | undefined;
		for (const group of groups) {
			const label = value(event, group);
			let node = map.get(label);
			if (!node) {
				node = { key: label, label, cost: 0, costInput: 0, costCacheRead: 0, costCacheWrite: 0, costOutput: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, turns: 0, uniqueSessions: 0, sessionIds: new Set(), children: [] };
				map.set(label, node);
				if (parent) parent.children.push(node);
			}
			node.cost += event.cost; node.costInput += event.costInput; node.costCacheRead += event.costCacheRead; node.costCacheWrite += event.costCacheWrite; node.costOutput += event.costOutput; node.input += event.input; node.cacheRead += event.cacheRead; node.cacheWrite += event.cacheWrite; node.output += event.output; node.reasoning += event.reasoning; node.turns++; node.sessionIds.add(event.sessionId);
			parent = node;
			map = new Map(node.children.map((child) => [child.key, child]));
		}
	}
	const sign = order === "asc" ? 1 : -1;
	const finalize = (nodes: InternalTreeNode[]): TreeNode[] => nodes
		.sort((a, b) => sign * (score(a, sort) - score(b, sort)) || a.label.localeCompare(b.label))
		.map((node) => {
			const prompt = node.input + node.cacheRead + node.cacheWrite;
			const output = { key: node.key, label: node.label, cost: node.cost, costInput: node.costInput, costCacheRead: node.costCacheRead, costCacheWrite: node.costCacheWrite, costOutput: node.costOutput, input: node.input, cacheRead: node.cacheRead, cacheWrite: node.cacheWrite, output: node.output, reasoning: node.reasoning, turns: node.turns, uniqueSessions: node.sessionIds.size, cacheReadRate: prompt ? node.cacheRead / prompt : undefined, children: finalize(node.children as InternalTreeNode[]) };
			sessions.set(output, node.sessionIds);
			return output;
		});
	return finalize([...root.values()]);
}

function title(group: GroupBy): string { return group === "day" ? "Date" : group[0]!.toUpperCase() + group.slice(1); }
function nodeSessions(node: TreeNode): Set<string> { return sessions.get(node) ?? new Set(Array.from({ length: node.uniqueSessions }, (_, index) => `${node.key}:${index}`)); }
function aggregate(node: TreeNode, children: TreeNode[]): TreeNode {
	if (!children.length) return node;
	const ids = new Set<string>(); for (const child of children) for (const id of nodeSessions(child)) ids.add(id);
	const output: TreeNode = { ...node, children, cost: children.reduce((sum, child) => sum + child.cost, 0), costInput: children.reduce((sum, child) => sum + child.costInput, 0), costCacheRead: children.reduce((sum, child) => sum + child.costCacheRead, 0), costCacheWrite: children.reduce((sum, child) => sum + child.costCacheWrite, 0), costOutput: children.reduce((sum, child) => sum + child.costOutput, 0), input: children.reduce((sum, child) => sum + child.input, 0), cacheRead: children.reduce((sum, child) => sum + child.cacheRead, 0), cacheWrite: children.reduce((sum, child) => sum + child.cacheWrite, 0), output: children.reduce((sum, child) => sum + child.output, 0), reasoning: children.reduce((sum, child) => sum + child.reasoning, 0), turns: children.reduce((sum, child) => sum + child.turns, 0), uniqueSessions: ids.size };
	const prompt = output.input + output.cacheRead + output.cacheWrite; output.cacheReadRate = prompt ? output.cacheRead / prompt : undefined; sessions.set(output, ids);
	return output;
}

export function renderTreeTable(nodes: TreeNode[], groups: GroupBy[], limit: number, subtotalGroups: GroupBy[] = [], detailed = false): string {
	const visible = (node: TreeNode): TreeNode => aggregate(node, node.children.slice(0, limit).map(visible));
	const rows: string[][] = [];
	const visit = (items: TreeNode[], path: string[], depth: number) => {
		const visibleItems = items.slice(0, limit).map(visible);
		for (const [index, node] of visibleItems.entries()) {
			const next = [...path, node.label];
			if (node.children.length) visit(node.children, next, depth + 1);
			else rows.push([...next, ...tableDataCells({ uniqueSessions: node.uniqueSessions, assistantTurns: node.turns, input: node.input, cacheRead: node.cacheRead, cacheWrite: node.cacheWrite, output: node.output, reasoning: node.reasoning, costInput: node.costInput, costCacheRead: node.costCacheRead, costCacheWrite: node.costCacheWrite, costOutput: node.costOutput, cost: node.cost, cacheReadRate: node.cacheReadRate }, detailed)]);
			if (!subtotalGroups.includes(groups[depth]!)) continue;
			const labels = [...next]; labels[depth] = `${node.label} Σ`; while (labels.length < groups.length) labels.push("");
			rows.push([...labels, ...tableDataCells({ uniqueSessions: node.uniqueSessions, assistantTurns: node.turns, input: node.input, cacheRead: node.cacheRead, cacheWrite: node.cacheWrite, output: node.output, reasoning: node.reasoning, costInput: node.costInput, costCacheRead: node.costCacheRead, costCacheWrite: node.costCacheWrite, costOutput: node.costOutput, cost: node.cost, cacheReadRate: node.cacheReadRate }, detailed)]);
			if (index < visibleItems.length - 1) rows.push([]);
		}
	};
	visit(nodes, [], 0);
	const headers = [...groups.map(title), ...tableHeaders(detailed)];
	const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)));
	const format = (row: string[]) => row.length ? row.map((value, index) => index === 0 ? value.padEnd(widths[index]!) : value.padStart(widths[index]!)).join("  ") : "";
	return [format(headers), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(format)].join("\n");
}
