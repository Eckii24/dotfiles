import { DATA_HEADERS, formatToken, tableDataCells } from "./render.js";
import type { GroupBy, SortOrder, UsageSort } from "./types.js";
import type { UsageEvent } from "./session-reader.js";

export interface TreeNode {
	key: string;
	label: string;
	cost: number;
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

function value(event: UsageEvent, group: GroupBy): string {
	if (group === "day") { const d = new Date(event.timestampMs); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
	if (group === "model") return `${event.provider}/${event.model}`;
	if (group === "session") return event.sessionTitle || event.sessionId;
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
				node = { key: label, label, cost: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, turns: 0, uniqueSessions: 0, sessionIds: new Set(), children: [] };
				map.set(label, node);
				if (parent) parent.children.push(node);
			}
			node.cost += event.cost; node.input += event.input; node.cacheRead += event.cacheRead; node.cacheWrite += event.cacheWrite; node.output += event.output; node.reasoning += event.reasoning; node.turns++; node.sessionIds.add(event.sessionId);
			parent = node;
			map = new Map(node.children.map((child) => [child.key, child]));
		}
	}
	const sign = order === "asc" ? 1 : -1;
	const finalize = (nodes: InternalTreeNode[]): TreeNode[] => nodes
		.sort((a, b) => sign * (score(a, sort) - score(b, sort)) || a.label.localeCompare(b.label))
		.map((node) => {
			const prompt = node.input + node.cacheRead + node.cacheWrite;
			return { key: node.key, label: node.label, cost: node.cost, input: node.input, cacheRead: node.cacheRead, cacheWrite: node.cacheWrite, output: node.output, reasoning: node.reasoning, turns: node.turns, uniqueSessions: node.sessionIds.size, cacheReadRate: prompt ? node.cacheRead / prompt : undefined, children: finalize(node.children as InternalTreeNode[]) };
		});
	return finalize([...root.values()]);
}

function title(group: GroupBy): string { return group === "day" ? "Date" : group[0]!.toUpperCase() + group.slice(1); }

export function renderTreeTable(nodes: TreeNode[], groups: GroupBy[], limit: number): string {
	const rows: string[][] = [];
	const visit = (items: TreeNode[], path: string[]) => {
		for (const node of items.slice(0, limit)) {
			const next = [...path, node.label];
			if (node.children.length) visit(node.children, next);
			else rows.push([...next, ...tableDataCells({ uniqueSessions: node.uniqueSessions, assistantTurns: node.turns, input: node.input, cacheRead: node.cacheRead, cacheWrite: node.cacheWrite, output: node.output, reasoning: node.reasoning, cost: node.cost, cacheReadRate: node.cacheReadRate })]);
		}
	};
	visit(nodes, []);
	const headers = [...groups.map(title), ...DATA_HEADERS];
	const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)));
	const format = (row: string[]) => row.map((value, index) => index === 0 ? value.padEnd(widths[index]!) : value.padStart(widths[index]!)).join("  ");
	return [format(headers), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(format)].join("\n");
}
