import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import type { AgentScope } from "./agents.js";
import {
	buildRunTreeForest,
	cloneRootRun,
	compactMessagesForRecentSummary,
	createEmptyUsageStats,
	deriveRootStatus,
	findRunTreeNode,
	findRunTreeNodeByTarget,
	flattenRunTree,
	getFinalOutput,
	getLiveRunTargetKey,
	getLatestActivityFromMessages,
	isActiveStatus,
	isTerminalStatus,
	toInlinePreview,
	type AgentSource,
	type LeafRunSnapshot,
	type RootRunSnapshot,
	type RunStatus,
	type RunTreeNode,
	type RunTreeRow,
} from "./run-model.js";

const MAX_RECENT_ROOTS = 12;

type RootListener = () => void;

interface CreateRootRunOptions {
	id: string;
	toolCallId?: string;
	mode: RootRunSnapshot["mode"];
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	startedAt?: number;
}

interface QueueLeafRunOptions {
	rootRunId: string;
	leafRunId: string;
	agent: string;
	agentSource: AgentSource;
	task: string;
	step?: number;
	status?: RunStatus;
	controllable?: boolean;
}

interface FinishLeafRunOptions {
	rootRunId: string;
	leafRunId: string;
	exitCode: number;
	stderr: string;
	stopReason?: string;
	errorMessage?: string;
	aborted?: boolean;
}

export class SubagentRunStore {
	private readonly roots = new Map<string, RootRunSnapshot>();
	private readonly listeners = new Set<RootListener>();
	private readonly liveTransportKeys = new Set<string>();
	private recentRootIds: string[] = [];

	subscribe(listener: RootListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	createRootRun(options: CreateRootRunOptions): RootRunSnapshot {
		const now = options.startedAt ?? Date.now();
		const root: RootRunSnapshot = {
			id: options.id,
			toolCallId: options.toolCallId,
			mode: options.mode,
			status: options.mode === "single" ? "running" : "queued",
			agentScope: options.agentScope,
			projectAgentsDir: options.projectAgentsDir,
			createdAt: now,
			updatedAt: now,
			startedAt: now,
			children: [],
		};
		this.roots.set(root.id, root);
		this.touchRecent(root.id, false);
		this.emitChange();
		return cloneRootRun(root);
	}

	queueLeafRun(options: QueueLeafRunOptions): LeafRunSnapshot {
		const root = this.requireRoot(options.rootRunId);
		const now = Date.now();
		const leaf: LeafRunSnapshot = {
			id: options.leafRunId,
			agent: options.agent,
			agentSource: options.agentSource,
			task: options.task,
			step: options.step,
			status: options.status ?? "queued",
			startedAt: options.status === "running" ? now : undefined,
			latestActivity: options.status === "queued" ? "queued" : undefined,
			messages: [],
			stderr: "",
			usage: createEmptyUsageStats(),
			queue: { steering: [], followUp: [] },
			steeringHistory: [],
			controllable: options.controllable ?? false,
		};
		root.children.push(leaf);
		this.refreshRoot(root, false);
		return structuredClone(leaf);
	}

	markLeafRunning(rootRunId: string, leafRunId: string, options?: { controllable?: boolean }): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			leaf.status = "running";
			leaf.startedAt ??= Date.now();
			leaf.latestActivity = leaf.latestActivity === "queued" ? "starting..." : leaf.latestActivity;
			if (options?.controllable !== undefined) leaf.controllable = options.controllable;
		});
	}

	appendAssistantMessage(rootRunId: string, leafRunId: string, message: Message): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			leaf.messages.push(message);
			this.applyAssistantMessage(leaf, message);
		});
	}

	upsertAssistantMessage(rootRunId: string, leafRunId: string, message: Message): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			const existingIndex = leaf.messages.findIndex(
				(candidate) => candidate.role === "assistant" && candidate.timestamp === message.timestamp,
			);
			if (existingIndex >= 0) leaf.messages[existingIndex] = message;
			else leaf.messages.push(message);
			this.applyAssistantMessage(leaf, message);
		});
	}

	upsertToolResultMessage(rootRunId: string, leafRunId: string, message: ToolResultMessage<any>): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			upsertToolResultMessage(leaf.messages, message);
			leaf.latestActivity = getLatestActivityFromMessages(leaf.messages) || leaf.latestActivity;
		});
	}

	updateToolExecution(rootRunId: string, leafRunId: string, toolName: string, preview?: string): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			leaf.latestActivity = preview ? `${toolName}: ${preview}` : `tool: ${toolName}`;
		});
	}

	setLeafQueue(rootRunId: string, leafRunId: string, steering: string[], followUp: string[]): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			leaf.queue = { steering: [...steering], followUp: [...followUp] };
			if (steering.length > 0) leaf.latestActivity = `${steering.length} steering queued`;
		});
	}

	recordSteeringRequest(
		rootRunId: string,
		leafRunId: string,
		entry: { id: string; text: string; delivery: "steer" | "followUp"; status: "queued" | "sent" | "failed"; error?: string },
	): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			const existing = leaf.steeringHistory.find((item) => item.id === entry.id);
			if (existing) {
				existing.status = entry.status;
				existing.error = entry.error;
				existing.text = entry.text;
			} else {
				leaf.steeringHistory.push({ ...entry, createdAt: Date.now() });
			}
			leaf.latestActivity =
				entry.status === "failed"
					? `steer failed: ${entry.error || "request failed"}`
					: entry.status === "sent"
						? `steer sent: ${entry.text.replace(/\s+/g, " ").trim().slice(0, 80)}`
						: `steer queued: ${entry.text.replace(/\s+/g, " ").trim().slice(0, 80)}`;
		});
	}

	markLeafSkipped(rootRunId: string, leafRunId: string, reason: string, status: RunStatus = "aborted"): void {
		this.updateLeaf(rootRunId, leafRunId, (leaf) => {
			leaf.status = status;
			leaf.endedAt = Date.now();
			leaf.latestActivity = reason;
			leaf.errorMessage = status === "failed" ? reason : leaf.errorMessage;
			leaf.controllable = false;
		});
	}

	finishLeafRun(options: FinishLeafRunOptions): LeafRunSnapshot {
		let finished!: LeafRunSnapshot;
		this.updateLeaf(options.rootRunId, options.leafRunId, (leaf) => {
			leaf.stderr = options.stderr;
			leaf.stopReason = options.stopReason ?? leaf.stopReason;
			leaf.errorMessage = options.errorMessage ?? leaf.errorMessage;
			leaf.endedAt = Date.now();
			const terminalStopReason = options.stopReason ?? leaf.stopReason;
			leaf.status = options.aborted || terminalStopReason === "aborted"
				? "aborted"
				: options.exitCode !== 0 || terminalStopReason === "error"
					? "failed"
					: "succeeded";
			leaf.finalOutput = getFinalOutput(leaf.messages) || leaf.finalOutput;
			if (leaf.status === "failed") {
				leaf.latestActivity = getLeafTerminalActivity(leaf, "failed");
			}
			if (leaf.status === "aborted") {
				leaf.latestActivity = getLeafTerminalActivity(leaf, "aborted");
			}
			if (leaf.messages.length > 0) {
				leaf.messages = compactMessagesForRecentSummary(leaf.messages);
			}
			leaf.controllable = false;
			finished = structuredClone(leaf);
		});
		return finished;
	}

	setRootSummary(rootRunId: string, summaryText: string): void {
		const root = this.requireRoot(rootRunId);
		root.summaryText = summaryText;
		this.refreshRoot(root, false);
	}

	getRootRun(rootRunId: string): RootRunSnapshot | undefined {
		const root = this.roots.get(rootRunId);
		return root ? cloneRootRun(root) : undefined;
	}

	getActiveRootRuns(): RootRunSnapshot[] {
		return Array.from(this.roots.values())
			.filter((root) => isActiveStatus(root.status))
			.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
			.map((root) => cloneRootRun(root));
	}

	getRecentRootRuns(limit = MAX_RECENT_ROOTS): RootRunSnapshot[] {
		return this.recentRootIds
			.map((id) => this.roots.get(id))
			.filter((root): root is RootRunSnapshot => Boolean(root) && isTerminalStatus(root.status))
			.slice(0, limit)
			.map((root) => cloneRootRun(root));
	}

	getAnyRootRuns(): RootRunSnapshot[] {
		return Array.from(this.roots.values())
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.map((root) => cloneRootRun(root));
	}

	getVisibleRootRuns(limit = MAX_RECENT_ROOTS): RootRunSnapshot[] {
		return [...this.getActiveRootRuns(), ...this.getRecentRootRuns(limit)];
	}

	setLiveTransport(rootRunId: string, leafRunId: string, live: boolean): void {
		const key = getLiveRunTargetKey({ transportRootRunId: rootRunId, transportLeafRunId: leafRunId });
		const alreadyLive = this.liveTransportKeys.has(key);
		if (live) {
			if (alreadyLive) return;
			this.liveTransportKeys.add(key);
			this.emitChange();
			return;
		}
		if (!alreadyLive) return;
		this.liveTransportKeys.delete(key);
		this.emitChange();
	}

	getActiveRunForest(): RunTreeNode[] {
		return buildRunTreeForest(this.getActiveRootRuns(), this.liveTransportKeys);
	}

	getVisibleRunForest(limit = MAX_RECENT_ROOTS): RunTreeNode[] {
		return buildRunTreeForest(this.getVisibleRootRuns(limit), this.liveTransportKeys);
	}

	getAnyRunForest(): RunTreeNode[] {
		return buildRunTreeForest(this.getAnyRootRuns(), this.liveTransportKeys);
	}

	getVisibleRunRows(limit = MAX_RECENT_ROOTS): RunTreeRow[] {
		return flattenRunTree(this.getVisibleRunForest(limit));
	}

	getVisibleRunNode(nodeId: string, limit = MAX_RECENT_ROOTS): RunTreeNode | undefined {
		return findRunTreeNode(this.getVisibleRunForest(limit), nodeId);
	}

	getAnyRunNode(nodeId: string): RunTreeNode | undefined {
		return findRunTreeNode(this.getAnyRunForest(), nodeId);
	}

	findRunNodeByTarget(targetRootRunId: string, targetLeafRunId: string): RunTreeNode | undefined {
		return findRunTreeNodeByTarget(this.getAnyRunForest(), targetRootRunId, targetLeafRunId);
	}

	clear(): void {
		this.roots.clear();
		this.liveTransportKeys.clear();
		this.recentRootIds = [];
		this.emitChange();
	}

	private updateLeaf(rootRunId: string, leafRunId: string, updater: (leaf: LeafRunSnapshot) => void): void {
		const root = this.requireRoot(rootRunId);
		const leaf = root.children.find((item) => item.id === leafRunId);
		if (!leaf) throw new Error(`Unknown subagent leaf run: ${leafRunId}`);
		updater(leaf);
		this.refreshRoot(root, false);
	}

	private applyAssistantMessage(leaf: LeafRunSnapshot, message: Message): void {
		leaf.finalOutput = getFinalOutput(leaf.messages) || undefined;
		leaf.latestActivity = getLatestActivityFromMessages(leaf.messages) || leaf.latestActivity;
		if (message.role === "assistant") {
			const usage = createEmptyUsageStats();
			for (const candidate of leaf.messages) {
				if (candidate.role !== "assistant") continue;
				usage.turns++;
				if (candidate.usage) {
					usage.input += candidate.usage.input || 0;
					usage.output += candidate.usage.output || 0;
					usage.cacheRead += candidate.usage.cacheRead || 0;
					usage.cacheWrite += candidate.usage.cacheWrite || 0;
					usage.cost += candidate.usage.cost?.total || 0;
					usage.contextTokens = Math.max(usage.contextTokens, candidate.usage.totalTokens || 0);
				}
				if (candidate.model) leaf.model = candidate.model;
				if (candidate.stopReason) leaf.stopReason = candidate.stopReason;
				if (candidate.errorMessage) leaf.errorMessage = candidate.errorMessage;
			}
			leaf.usage = usage;
		}
	}

	private refreshRoot(root: RootRunSnapshot, skipEmit: boolean): void {
		root.updatedAt = Date.now();
		root.status = deriveRootStatus(root.children);
		root.latestActivity = getRootLatestActivity(root.children);

		if (isTerminalStatus(root.status)) {
			root.endedAt ??= Date.now();
			this.touchRecent(root.id, true);
		} else {
			root.endedAt = undefined;
			this.touchRecent(root.id, false);
		}

		if (!skipEmit) this.emitChange();
	}

	private touchRecent(rootId: string, terminal: boolean): void {
		this.recentRootIds = this.recentRootIds.filter((id) => id !== rootId);
		if (terminal) this.recentRootIds.unshift(rootId);
		while (this.recentRootIds.length > MAX_RECENT_ROOTS) {
			const evictedId = this.recentRootIds.pop();
			if (!evictedId) continue;
			const evicted = this.roots.get(evictedId);
			if (evicted && isTerminalStatus(evicted.status)) this.roots.delete(evictedId);
		}
	}

	private requireRoot(rootRunId: string): RootRunSnapshot {
		const root = this.roots.get(rootRunId);
		if (!root) throw new Error(`Unknown subagent root run: ${rootRunId}`);
		return root;
	}

	private emitChange(): void {
		for (const listener of this.listeners) listener();
	}
}

function getLeafTerminalActivity(
	leaf: Pick<LeafRunSnapshot, "errorMessage" | "stderr" | "finalOutput" | "latestActivity">,
	fallback: "failed" | "aborted",
): string {
	return toInlinePreview(leaf.errorMessage || leaf.stderr || leaf.finalOutput || leaf.latestActivity || fallback, 160) || fallback;
}

function getRootLatestActivity(children: LeafRunSnapshot[]): string | undefined {
	const runningActivity = children.find((child) => child.status === "running")?.latestActivity;
	if (runningActivity) return runningActivity;

	const queuedActivity = children.find((child) => child.status === "queued")?.latestActivity;
	if (queuedActivity) return queuedActivity;

	const failedChild = [...children].reverse().find((child) => child.status === "failed");
	if (failedChild) return getLeafTerminalActivity(failedChild, "failed");

	const recentChild = [...children]
		.reverse()
		.find((child) => Boolean(child.latestActivity || child.finalOutput || child.errorMessage || child.stderr));
	if (!recentChild) return undefined;
	if (recentChild.status === "aborted") return getLeafTerminalActivity(recentChild, "aborted");
	return recentChild.latestActivity || recentChild.finalOutput || recentChild.errorMessage || recentChild.stderr;
}

function upsertToolResultMessage(messages: Message[], message: ToolResultMessage<any>): void {
	const existingIndex = messages.findIndex(
		(candidate) => candidate.role === "toolResult" && candidate.toolCallId === message.toolCallId,
	);
	if (existingIndex >= 0) messages[existingIndex] = message;
	else messages.push(message);
}
