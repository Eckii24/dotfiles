import * as os from "node:os";
import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import type { AgentScope } from "./agents.js";

export type SubagentMode = "single" | "parallel" | "chain";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "aborted";
export type AgentSource = "user" | "project" | "unknown";

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SteeringMessageSnapshot {
	id: string;
	text: string;
	delivery: "steer" | "followUp";
	status: "queued" | "sent" | "failed";
	createdAt: number;
	error?: string;
}

export interface LeafRunSnapshot {
	id: string;
	agent: string;
	agentSource: AgentSource;
	task: string;
	step?: number;
	status: RunStatus;
	startedAt?: number;
	endedAt?: number;
	latestActivity?: string;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	finalOutput?: string;
	queue: {
		steering: string[];
		followUp: string[];
	};
	steeringHistory: SteeringMessageSnapshot[];
	controllable: boolean;
}

export interface RootRunSnapshot {
	id: string;
	toolCallId?: string;
	mode: SubagentMode;
	status: RunStatus;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	createdAt: number;
	updatedAt: number;
	startedAt: number;
	endedAt?: number;
	latestActivity?: string;
	summaryText?: string;
	children: LeafRunSnapshot[];
}

export interface SubagentToolDetails {
	version: 2;
	run: RootRunSnapshot;
}

export interface LegacySingleResult {
	agent: string;
	agentSource: AgentSource;
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

export interface LegacySubagentDetails {
	mode: SubagentMode;
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: LegacySingleResult[];
}

export interface TextDisplayItem {
	type: "text";
	text: string;
}

export interface ToolCallDisplayItem {
	type: "toolCall";
	id: string;
	name: string;
	args: Record<string, any>;
	result?: ToolResultMessage<any>;
}

export type DisplayItem = TextDisplayItem | ToolCallDisplayItem;

export type RunTreeNodeKind = "topLevelRun" | "topLevelLeaf" | "nestedRun" | "nestedLeaf";

export interface LiveRunTarget {
	transportRootRunId: string;
	transportLeafRunId: string;
	targetRootRunId: string;
	targetLeafRunId: string;
	proxied: boolean;
}

export interface RunTreeNode {
	id: string;
	rootRunId: string;
	parentId?: string;
	depth: number;
	kind: RunTreeNodeKind;
	status: RunStatus;
	title: string;
	summary?: string;
	preview?: string;
	breadcrumb: string[];
	controllable: boolean;
	liveTarget?: LiveRunTarget;
	root?: RootRunSnapshot;
	leaf?: LeafRunSnapshot;
	children: RunTreeNode[];
}

export interface RunTreeRow {
	nodeId: string;
	rootRunId: string;
	parentId?: string;
	depth: number;
	kind: RunTreeNodeKind;
	status: RunStatus;
	title: string;
	summary?: string;
	preview?: string;
	controllable: boolean;
	liveTarget?: LiveRunTarget;
	breadcrumb: string[];
	ancestorIsLast: boolean[];
	isLastSibling: boolean;
	node: RunTreeNode;
}

const MAX_RECENT_SUMMARY_MESSAGES = 12;
const MAX_SUMMARY_TEXT_LENGTH = 400;

export function getLiveRunTargetKey(target: Pick<LiveRunTarget, "transportRootRunId" | "transportLeafRunId">): string {
	return `${target.transportRootRunId}::${target.transportLeafRunId}`;
}

export function createEmptyUsageStats(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function cloneRootRun(run: RootRunSnapshot): RootRunSnapshot {
	return structuredClone(run);
}

export function toSubagentToolDetails(run: RootRunSnapshot): SubagentToolDetails {
	return { version: 2, run: cloneRootRun(run) };
}

export function isToolResultMessage(message: Message): message is ToolResultMessage<any> {
	return (message as ToolResultMessage<any>).role === "toolResult";
}

export function isSubagentToolDetails(details: unknown): details is SubagentToolDetails {
	return Boolean(details && typeof details === "object" && (details as SubagentToolDetails).version === 2 && (details as SubagentToolDetails).run);
}

export function isLegacySubagentDetails(details: unknown): details is LegacySubagentDetails {
	return Boolean(details && typeof details === "object" && Array.isArray((details as LegacySubagentDetails).results));
}

export function normalizeSubagentDetails(details: unknown): RootRunSnapshot | undefined {
	if (isSubagentToolDetails(details)) return cloneRootRun(details.run);
	if (!isLegacySubagentDetails(details)) return undefined;

	const now = Date.now();
	const children: LeafRunSnapshot[] = details.results.map((result, index) => ({
		id: `legacy-${index + 1}`,
		agent: result.agent,
		agentSource: result.agentSource,
		task: result.task,
		step: result.step,
		status: getStatusFromLegacyResult(result),
		startedAt: now,
		endedAt: result.exitCode >= 0 ? now : undefined,
		latestActivity: getLatestActivityFromMessages(result.messages) || getFinalOutput(result.messages) || undefined,
		messages: result.messages,
		stderr: result.stderr,
		usage: result.usage,
		model: result.model,
		stopReason: result.stopReason,
		errorMessage: result.errorMessage,
		finalOutput: getFinalOutput(result.messages) || undefined,
		queue: { steering: [], followUp: [] },
		steeringHistory: [],
		controllable: false,
	}));

	return {
		id: "legacy-root",
		mode: details.mode,
		status: deriveRootStatus(children),
		agentScope: details.agentScope,
		projectAgentsDir: details.projectAgentsDir,
		createdAt: now,
		updatedAt: now,
		startedAt: now,
		endedAt: isTerminalStatus(deriveRootStatus(children)) ? now : undefined,
		latestActivity: children.find((child) => child.status === "running")?.latestActivity ?? children.at(-1)?.latestActivity,
		children,
	};
}

export function getStatusFromLegacyResult(result: LegacySingleResult): RunStatus {
	if (result.exitCode === -2) return "queued";
	if (result.exitCode === -1) return "running";
	if (result.stopReason === "aborted") return "aborted";
	if (result.exitCode !== 0 || result.stopReason === "error") return "failed";
	return "succeeded";
}

export function isActiveStatus(status: RunStatus): boolean {
	return status === "queued" || status === "running";
}

export function isTerminalStatus(status: RunStatus): boolean {
	return !isActiveStatus(status);
}

export function deriveRootStatus(children: LeafRunSnapshot[]): RunStatus {
	if (children.length === 0) return "succeeded";
	if (children.some((child) => child.status === "running")) return "running";
	if (children.some((child) => child.status === "queued")) return "queued";
	if (children.some((child) => child.status === "failed")) return "failed";
	if (children.some((child) => child.status === "aborted")) return "aborted";
	return "succeeded";
}

export function getStatusCounts(root: RootRunSnapshot): {
	queued: number;
	running: number;
	succeeded: number;
	failed: number;
	aborted: number;
	done: number;
} {
	const counts = { queued: 0, running: 0, succeeded: 0, failed: 0, aborted: 0, done: 0 };
	for (const child of root.children) {
		counts[child.status]++;
		if (isTerminalStatus(child.status)) counts.done++;
	}
	return counts;
}

export function getActiveLeaf(root: RootRunSnapshot): LeafRunSnapshot | undefined {
	return root.children.find((child) => child.status === "running") ?? root.children.find((child) => child.status === "queued");
}

export function getFocusedLeaf(root: RootRunSnapshot): LeafRunSnapshot | undefined {
	return getActiveLeaf(root)
		?? [...root.children].reverse().find((child) => child.status === "failed")
		?? [...root.children].reverse().find((child) => child.messages.length > 0 || Boolean(child.finalOutput || child.errorMessage || child.stderr))
		?? root.children.at(-1);
}

export function getLatestActivityFromMessages(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === "assistant") {
			for (let j = message.content.length - 1; j >= 0; j--) {
				const part = message.content[j];
				if (part.type === "text") {
					const preview = toInlinePreview(part.text, 120);
					if (preview) return preview;
				}
				if (part.type === "toolCall") {
					return `tool: ${part.name}`;
				}
			}
		}
		if (isToolResultMessage(message)) {
			const preview = toInlinePreview(getToolResultText(message), 120);
			if (preview) return preview;
		}
	}
	return "";
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (let j = msg.content.length - 1; j >= 0; j--) {
				const part = msg.content[j];
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	const pendingToolCalls = new Map<string, ToolCallDisplayItem>();

	for (const message of messages) {
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text") {
					if (part.text.trim()) items.push({ type: "text", text: part.text });
				} else if (part.type === "toolCall") {
					const item: ToolCallDisplayItem = {
						type: "toolCall",
						id: part.id,
						name: part.name,
						args: part.arguments,
					};
					items.push(item);
					pendingToolCalls.set(part.id, item);
				}
			}
		} else if (isToolResultMessage(message)) {
			const item = pendingToolCalls.get(message.toolCallId);
			if (item) item.result = message;
		}
	}

	return items;
}

export function getToolCallItems(messages: Message[]): ToolCallDisplayItem[] {
	return getDisplayItems(messages).filter((item): item is ToolCallDisplayItem => item.type === "toolCall");
}

export function getToolResultText(result?: ToolResultMessage<any>): string {
	if (!result) return "";
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

export function compactMessagesForRecentSummary(messages: Message[], maxMessages = MAX_RECENT_SUMMARY_MESSAGES): Message[] {
	return messages.slice(-Math.max(1, maxMessages)).map((message) => compactMessageText(message, MAX_SUMMARY_TEXT_LENGTH));
}

function compactMessageText(message: Message, maxTextLength: number): Message {
	const clone = structuredClone(message) as any;
	if (Array.isArray(clone.content)) {
		clone.content = clone.content.map((part: any) =>
			part?.type === "text"
				? { ...part, text: truncateMessageText(String(part.text ?? ""), maxTextLength) }
				: part,
		);
	}
	return clone as Message;
}

function truncateMessageText(text: string, maxTextLength: number): string {
	if (text.length <= maxTextLength) return text;
	return `${text.slice(0, Math.max(0, maxTextLength - 3)).trimEnd()}...`;
}

export function toInlinePreview(text: string, maxLength: number): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "";
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

export function aggregateUsage(children: LeafRunSnapshot[]): UsageStats {
	const total = createEmptyUsageStats();
	for (const child of children) {
		total.input += child.usage.input;
		total.output += child.usage.output;
		total.cacheRead += child.usage.cacheRead;
		total.cacheWrite += child.usage.cacheWrite;
		total.cost += child.usage.cost;
		total.turns += child.usage.turns;
		total.contextTokens = Math.max(total.contextTokens, child.usage.contextTokens);
	}
	return total;
}

export function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (inputPath: string) => {
		const home = os.homedir();
		return inputPath.startsWith(home) ? `~${inputPath.slice(home.length)}` : inputPath;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			return themeFg("muted", "$ ") + themeFg("toolOutput", command);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "grep ") + themeFg("accent", `/${pattern}/`) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		default:
			return themeFg("accent", toolName) + themeFg("dim", ` ${JSON.stringify(args)}`);
	}
}

export function getRunStatusIcon(status: RunStatus, theme: any): string {
	switch (status) {
		case "queued":
			return theme.fg("muted", "○");
		case "running":
			return theme.fg("warning", "⏳");
		case "failed":
			return theme.fg("error", "✗");
		case "aborted":
			return theme.fg("warning", "◼");
		default:
			return theme.fg("success", "✓");
	}
}

export function getRootStatusLabel(root: RootRunSnapshot): string {
	const counts = getStatusCounts(root);
	if (root.mode === "chain") {
		if (isActiveStatus(root.status)) {
			const activeStep = root.children.find((child) => child.status === "running")?.step ?? root.children.find((child) => child.status === "queued")?.step;
			return `${counts.done}/${root.children.length} steps${activeStep ? ` · step ${activeStep}` : ""}`;
		}
		return `${counts.succeeded}/${root.children.length} steps`;
	}

	if (root.mode === "parallel") {
		const pending: string[] = [];
		if (counts.running > 0) pending.push(`${counts.running} running`);
		if (counts.queued > 0) pending.push(`${counts.queued} queued`);
		return pending.length > 0 ? `${counts.done}/${root.children.length} done · ${pending.join(", ")}` : `${counts.succeeded}/${root.children.length} tasks`;
	}

	const child = root.children[0];
	if (!child) return root.status;
	return child.latestActivity || child.finalOutput || child.status;
}

export function buildDefaultRootSummary(root: RootRunSnapshot): string {
	const activeLeaf = getActiveLeaf(root);
	if (root.mode === "single" && root.children.length === 1) {
		const child = root.children[0]!;
		if (child.status === "running") return child.latestActivity || child.finalOutput || "(running...)";
		return child.finalOutput || child.errorMessage || child.stderr || "(no output)";
	}

	if (root.mode === "chain") {
		const currentStep = activeLeaf?.step;
		return currentStep
			? `Chain: step ${currentStep}/${root.children.length}${root.latestActivity ? ` · ${root.latestActivity}` : ""}`
			: `Chain: ${getStatusCounts(root).done}/${root.children.length} steps`;
	}

	const counts = getStatusCounts(root);
	const pending: string[] = [];
	if (counts.running > 0) pending.push(`${counts.running} running`);
	if (counts.queued > 0) pending.push(`${counts.queued} queued`);
	return `Parallel: ${counts.done}/${root.children.length} done${pending.length > 0 ? `, ${pending.join(", ")}` : ""}`;
}

export function getRootTreeTitle(root: RootRunSnapshot): string {
	if (root.mode === "single") {
		const child = root.children[0];
		return child ? `single · ${child.agent}` : "single";
	}
	if (root.mode === "chain") {
		return `chain · ${root.children.length} step${root.children.length === 1 ? "" : "s"}`;
	}
	return `parallel · ${root.children.length} task${root.children.length === 1 ? "" : "s"}`;
}

export function getLeafTreeTitle(leaf: LeafRunSnapshot): string {
	return leaf.step ? `step ${leaf.step} · ${leaf.agent}` : leaf.agent;
}

export function getLeafPreview(leaf: LeafRunSnapshot, maxLength = 120): string | undefined {
	const candidates = leaf.status === "running"
		? [leaf.latestActivity, getLatestActivityFromMessages(leaf.messages), leaf.finalOutput, getFinalOutput(leaf.messages)]
		: leaf.status === "queued"
			? [leaf.latestActivity, "queued"]
			: leaf.status === "failed"
				? [leaf.errorMessage, leaf.stderr, leaf.latestActivity, leaf.finalOutput, getFinalOutput(leaf.messages), "failed"]
				: leaf.status === "aborted"
					? [leaf.latestActivity, leaf.errorMessage, leaf.finalOutput, getFinalOutput(leaf.messages), "aborted"]
					: [leaf.finalOutput, getFinalOutput(leaf.messages), leaf.latestActivity];
	return pickUsefulPreview(candidates, [leaf.task, getLeafTreeTitle(leaf)], maxLength);
}

export function getRootPreview(root: RootRunSnapshot, maxLength = 120): string | undefined {
	const activeLeaf = getActiveLeaf(root);
	const focusedLeaf = getFocusedLeaf(root);
	const candidates = root.status === "running"
		? [root.latestActivity, activeLeaf ? getLeafPreview(activeLeaf, maxLength) : undefined, root.summaryText]
		: root.status === "queued"
			? [root.latestActivity, root.summaryText, "queued"]
			: root.status === "failed"
				? [root.summaryText, root.latestActivity, focusedLeaf?.errorMessage, focusedLeaf?.stderr, focusedLeaf?.finalOutput]
				: root.status === "aborted"
					? [root.summaryText, root.latestActivity, focusedLeaf?.latestActivity, focusedLeaf?.finalOutput, "aborted"]
					: [root.summaryText, focusedLeaf ? getLeafPreview(focusedLeaf, maxLength) : undefined, root.latestActivity];
	const duplicateAgainst = [getRootTreeTitle(root), root.mode === "single" ? undefined : getRootStatusLabel(root)];
	return pickUsefulPreview(candidates, duplicateAgainst, maxLength);
}

export function buildRunTreeForest(
	roots: RootRunSnapshot[],
	actionableLiveTargetKeys?: ReadonlySet<string>,
): RunTreeNode[] {
	const resolvedActionableLiveTargetKeys = actionableLiveTargetKeys ?? collectControllableLiveTargetKeys(roots);
	return roots.map((root) => buildRootTreeNode(root, {
		rootRunId: root.id,
		depth: 0,
		kind: "topLevelRun",
		breadcrumb: [],
		parentId: undefined,
		nodeId: `root:${root.id}`,
		actionableLiveTargetKeys: resolvedActionableLiveTargetKeys,
	}));
}

function collectControllableLiveTargetKeys(roots: ReadonlyArray<RootRunSnapshot>): Set<string> {
	const liveTargetKeys = new Set<string>();
	for (const root of roots) {
		for (const leaf of root.children) {
			if (!leaf.controllable) continue;
			liveTargetKeys.add(getLiveRunTargetKey({ transportRootRunId: root.id, transportLeafRunId: leaf.id }));
		}
	}
	return liveTargetKeys;
}

export function flattenRunTree(nodes: RunTreeNode[]): RunTreeRow[] {
	const rows: RunTreeRow[] = [];
	const visit = (node: RunTreeNode, ancestorIsLast: boolean[], isLastSibling: boolean) => {
		rows.push({
			nodeId: node.id,
			rootRunId: node.rootRunId,
			parentId: node.parentId,
			depth: node.depth,
			kind: node.kind,
			status: node.status,
			title: node.title,
			summary: node.summary,
			preview: node.preview,
			controllable: node.controllable,
			liveTarget: node.liveTarget,
			breadcrumb: node.breadcrumb,
			ancestorIsLast,
			isLastSibling,
			node,
		});
		node.children.forEach((child, index) => {
			visit(child, [...ancestorIsLast, isLastSibling], index === node.children.length - 1);
		});
	};
	for (let index = 0; index < nodes.length; index++) {
		visit(nodes[index]!, [], index === nodes.length - 1);
	}
	return rows;
}

export function findRunTreeNode(nodes: ReadonlyArray<RunTreeNode>, nodeId: string): RunTreeNode | undefined {
	for (const node of nodes) {
		if (node.id === nodeId) return node;
		const childMatch = findRunTreeNode(node.children, nodeId);
		if (childMatch) return childMatch;
	}
	return undefined;
}

export function findRunTreeNodeByTarget(
	nodes: ReadonlyArray<RunTreeNode>,
	targetRootRunId: string,
	targetLeafRunId: string,
): RunTreeNode | undefined {
	for (const node of nodes) {
		if (node.rootRunId === targetRootRunId && node.leaf?.id === targetLeafRunId) return node;
		const childMatch = findRunTreeNodeByTarget(node.children, targetRootRunId, targetLeafRunId);
		if (childMatch) return childMatch;
	}
	return undefined;
}

export function getRunTreeNodeActionHint(node: RunTreeNode): string {
	if (node.controllable && node.leaf) {
		return node.liveTarget?.proxied
			? `Live nested target: ${node.leaf.agent}. Steer/abort proxy through the nearest live child transport.`
			: `Live target: ${node.leaf.agent}`;
	}
	if (node.kind === "topLevelRun" || node.kind === "nestedRun") return "Inspect-only. Select a live agent leaf to steer or abort.";
	if (node.kind === "nestedLeaf") return isActiveStatus(node.status)
		? "Inspect-only. This nested node is live in a session snapshot, but no reachable live child-transport proxy path is available here now."
		: "Historical only. Nested subagent leaves remain inspectable after completion.";
	if (isTerminalStatus(node.status)) return "Historical only. Completed nodes can be inspected but not steered.";
	return "Inspect-only. This node is not currently live-controllable.";
}

function buildRootTreeNode(
	root: RootRunSnapshot,
	options: {
		rootRunId: string;
		depth: number;
		kind: Extract<RunTreeNodeKind, "topLevelRun" | "nestedRun">;
		breadcrumb: string[];
		parentId?: string;
		nodeId: string;
		actionableLiveTargetKeys: ReadonlySet<string>;
		transportRootRunId?: string;
		transportLeafRunId?: string;
	},
): RunTreeNode {
	const title = getRootTreeTitle(root);
	const nodeBreadcrumb = [...options.breadcrumb, title];
	const summary = root.mode === "single" ? undefined : getRootStatusLabel(root);
	const nodeIdPrefix = `${options.nodeId}/tool`;
	const children = root.children.map((leaf, index) =>
		buildLeafTreeNode(leaf, {
			rootRunId: options.rootRunId,
			parentId: options.nodeId,
			depth: options.depth + 1,
			kind: options.kind === "topLevelRun" ? "topLevelLeaf" : "nestedLeaf",
			breadcrumb: nodeBreadcrumb,
			toolPrefix: `${nodeIdPrefix}:${index + 1}`,
			actionableLiveTargetKeys: options.actionableLiveTargetKeys,
			transportRootRunId: options.transportRootRunId,
			transportLeafRunId: options.transportLeafRunId,
		}),
	);
	return {
		id: options.nodeId,
		rootRunId: options.rootRunId,
		parentId: options.parentId,
		depth: options.depth,
		kind: options.kind,
		status: root.status,
		title,
		summary,
		preview: getRootPreview(root),
		breadcrumb: nodeBreadcrumb,
		controllable: false,
		root,
		children,
	};
}

function buildLeafTreeNode(
	leaf: LeafRunSnapshot,
	options: {
		rootRunId: string;
		parentId: string;
		depth: number;
		kind: Extract<RunTreeNodeKind, "topLevelLeaf" | "nestedLeaf">;
		breadcrumb: string[];
		toolPrefix: string;
		actionableLiveTargetKeys: ReadonlySet<string>;
		transportRootRunId?: string;
		transportLeafRunId?: string;
	},
): RunTreeNode {
	const title = getLeafTreeTitle(leaf);
	const nodeId = `${options.parentId}/leaf:${leaf.id}`;
	const nodeBreadcrumb = [...options.breadcrumb, title];
	const children = getToolCallItems(leaf.messages)
		.map((item, index) => {
			const nestedRun = normalizeSubagentDetails(item.result?.details);
			if (!nestedRun) return undefined;
			return buildRootTreeNode(nestedRun, {
				rootRunId: nestedRun.id,
				parentId: nodeId,
				depth: options.depth + 1,
				kind: "nestedRun",
				breadcrumb: nodeBreadcrumb,
				nodeId: `${options.toolPrefix}:${item.id || index + 1}`,
				actionableLiveTargetKeys: options.actionableLiveTargetKeys,
				transportRootRunId: options.transportRootRunId ?? options.rootRunId,
				transportLeafRunId: options.transportLeafRunId ?? leaf.id,
			});
		})
		.filter((node): node is RunTreeNode => Boolean(node));
	const transportRootRunId = options.transportRootRunId ?? options.rootRunId;
	const transportLeafRunId = options.transportLeafRunId ?? leaf.id;
	const transportLive = options.actionableLiveTargetKeys.has(getLiveRunTargetKey({ transportRootRunId, transportLeafRunId }));
	const proxied = transportRootRunId !== options.rootRunId || transportLeafRunId !== leaf.id;
	const controllable = leaf.controllable && transportLive;
	return {
		id: nodeId,
		rootRunId: options.rootRunId,
		parentId: options.parentId,
		depth: options.depth,
		kind: options.kind,
		status: leaf.status,
		title,
		preview: getLeafPreview(leaf),
		breadcrumb: nodeBreadcrumb,
		controllable,
		liveTarget: controllable
			? {
				transportRootRunId,
				transportLeafRunId,
				targetRootRunId: options.rootRunId,
				targetLeafRunId: leaf.id,
				proxied,
			}
			: undefined,
		leaf,
		children,
	};
}

function pickUsefulPreview(
	candidates: Array<string | undefined>,
	duplicateAgainst: Array<string | undefined>,
	maxLength: number,
): string | undefined {
	for (const candidate of candidates) {
		const preview = candidate ? toInlinePreview(candidate, maxLength) : "";
		if (!preview) continue;
		if (isDuplicatePreview(preview, duplicateAgainst)) continue;
		return preview;
	}
	return undefined;
}

function isDuplicatePreview(preview: string, candidates: Array<string | undefined>): boolean {
	const normalizedPreview = normalizePreview(preview);
	if (!normalizedPreview) return true;
	return candidates.some((candidate) => {
		const normalizedCandidate = normalizePreview(candidate || "");
		if (!normalizedCandidate) return false;
		return normalizedPreview === normalizedCandidate
			|| normalizedPreview.includes(normalizedCandidate)
			|| normalizedCandidate.includes(normalizedPreview);
	});
}

function normalizePreview(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}
