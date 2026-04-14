import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildMemoryCompactionResult, loadLatestMemoryCompactionState } from "./compaction.js";
import { buildBaseContextPackage, buildTaskContextPackage, formatMemoryStatusReport } from "./context-package.js";
import type { ContextPackage, MemoryCompactionState, MemoryPaths } from "./contracts.js";
import { applyLearningActions, loadPendingLearnings, summarizePendingLearnings } from "./learnings.js";
import { buildPendingReviewPrompt, shouldAutoDispatchPendingReview } from "./pending-review.js";
import {
	applyMemoryProposalActions,
	loadPendingMemoryProposals,
	summarizePendingMemoryProposals,
} from "./promotions.js";
import { resolveMemoryPaths } from "./paths.js";

const BASE_MESSAGE_TYPE = "memory-system-base";
const TASK_MESSAGE_TYPE = "memory-system-task";
const SUBAGENT_ENV = "PI_SUBAGENT";
const IS_SUBAGENT = process.env[SUBAGENT_ENV] === "1";

const LearningActionSchema = Type.Object({
	action: Type.Union([Type.Literal("approve"), Type.Literal("queue"), Type.Literal("reject")]),
	target: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("project")])),
	title: Type.String({ description: "Short learning title." }),
	category: Type.Union([
		Type.Literal("mistake-pattern"),
		Type.Literal("successful-tactic"),
		Type.Literal("user-preference"),
		Type.Literal("convention-discovery"),
		Type.Literal("tool-usage-pattern"),
	]),
	scopeLabel: Type.String({ description: "Learning scope label such as global or project:<name>." }),
	source: Type.String({ description: "Learning source, e.g. manual, review:<slug>, scheduled-analysis:<date>." }),
	confidence: Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")]),
	pattern: Type.Optional(Type.String()),
	recommendation: Type.Optional(Type.String()),
	evidence: Type.Array(Type.String(), { description: "Exact evidence paths or references." }),
	occurrenceDelta: Type.Optional(Type.Number({ minimum: 0 })),
	supersedes: Type.Optional(Type.String()),
	extends: Type.Optional(Type.String()),
	derivedFrom: Type.Optional(Type.Array(Type.String())),
});

const LearningActionToolParams = Type.Object({
	actions: Type.Array(LearningActionSchema, { description: "Approved, queued, or rejected learning recommendations to apply." }),
});

const MemoryProposalActionSchema = Type.Object({
	action: Type.Union([Type.Literal("approve"), Type.Literal("queue"), Type.Literal("reject")]),
	target: Type.Union([
		Type.Literal("conventions"),
		Type.Literal("pitfalls"),
		Type.Literal("decision"),
		Type.Literal("user-profile"),
		Type.Literal("project-profile"),
	]),
	title: Type.String({ description: "Short durable/profile proposal title." }),
	scopeLabel: Type.String({ description: "Scope label for the proposal, e.g. global or project:<name>." }),
	source: Type.String({ description: "Proposal source, e.g. promotion:L-... or manual." }),
	content: Type.String({ description: "The approved durable/profile change summary to persist." }),
	evidence: Type.Array(Type.String(), { description: "Exact evidence paths or references." }),
	section: Type.Optional(Type.String({ description: "Target profile section when writing to a profile file." })),
	slug: Type.Optional(Type.String({ description: "Optional decision slug override." })),
	supersedes: Type.Optional(Type.String()),
	extends: Type.Optional(Type.String()),
	derivedFrom: Type.Optional(Type.Array(Type.String())),
});

const MemoryProposalToolParams = Type.Object({
	actions: Type.Array(MemoryProposalActionSchema, { description: "Approved, queued, or rejected durable/profile proposals." }),
});

interface RuntimeState {
	paths?: MemoryPaths;
	basePackage?: ContextPackage;
	taskPackage?: ContextPackage;
	lastPrompt?: string;
	preservedCompactionState?: MemoryCompactionState;
}

function updateStatus(ctx: ExtensionContext, state: RuntimeState): void {
	if (IS_SUBAGENT || !ctx.hasUI || !state.basePackage) return;
	const base = state.basePackage.diagnostics.budget;
	const task = state.taskPackage?.diagnostics.budget;
	const taskSuffix = task ? ` • task ${task.used}/${task.limit}` : "";
	ctx.ui.setStatus(
		"memory-system",
		ctx.ui.theme.fg("dim", `memory base ${base.used}/${base.limit}${taskSuffix}`),
	);
}

function latestCustomMessageHash(ctx: ExtensionContext, customType: string): string | undefined {
	const entries = ctx.sessionManager.getBranch() as Array<{ type: string; customType?: string; details?: { hash?: string } }>;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom_message" || entry.customType !== customType) continue;
		return entry.details?.hash;
	}
	return undefined;
}

function sendBasePackageIfNeeded(pi: ExtensionAPI, ctx: ExtensionContext, state: RuntimeState): void {
	if (IS_SUBAGENT || !state.basePackage) return;
	if (latestCustomMessageHash(ctx, BASE_MESSAGE_TYPE) === state.basePackage.hash) return;
	pi.sendMessage({
		customType: BASE_MESSAGE_TYPE,
		content: state.basePackage.content,
		display: false,
		details: {
			hash: state.basePackage.hash,
			diagnostics: state.basePackage.diagnostics,
		},
	});
}

async function refreshBaseState(state: RuntimeState, cwd: string): Promise<void> {
	state.paths = await resolveMemoryPaths(cwd);
	state.basePackage = await buildBaseContextPackage(state.paths, {
		preservedCompactionState: state.preservedCompactionState,
	});
}

export default function memorySystem(pi: ExtensionAPI) {
	const state: RuntimeState = {};

	pi.registerTool({
		name: "memory_apply_learning_actions",
		label: "Apply Learning Actions",
		description:
			"Persist approved learning recommendations, queue deferred ones, and clear reviewed items from pending learnings. Use only after explicit questionnaire approval.",
		promptSnippet: "Persist approved or queued learning recommendations after explicit questionnaire approval.",
		promptGuidelines: [
			"Use this tool only after the user has approved learning actions via questionnaire.",
			"Pass exact evidence paths and set action to approve, queue, or reject for each recommendation.",
		],
		parameters: LearningActionToolParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paths = await resolveMemoryPaths(ctx.cwd);
			const result = await applyLearningActions(paths, params.actions.map((action) => ({
				...action,
				storeTarget: action.target ?? "project",
				occurrenceDelta: Math.max(0, action.occurrenceDelta ?? 0),
				derivedFrom: action.derivedFrom ?? [],
			})));
			state.paths = paths;
			await refreshBaseState(state, ctx.cwd);
			sendBasePackageIfNeeded(pi, ctx, state);
			updateStatus(ctx, state);
			const lines = [
				`Applied learning actions.`,
				`Approved (global): ${result.approvedGlobal}`,
				`Approved (project): ${result.approvedProject}`,
				`Queued: ${result.queued}`,
				`Rejected: ${result.rejected}`,
				`Blocked by capacity: ${result.blockedByCapacity}`,
				result.blockedByCapacity > 0
					? `Capacity targets: ${result.capacityTargets.join(", ")}. Ask the user via questionnaire whether to archive, promote, or delete lower-value records before re-approving.`
					: `Capacity targets: none`,
				`Pending remaining: ${result.pendingCount}`,
				`Changed paths: ${result.changedPaths.join(", ") || "none"}`,
			];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "memory_apply_memory_proposals",
		label: "Apply Memory Proposals",
		description:
			"Persist approved durable memory or profile proposals, queue deferred ones, and clear reviewed pending proposals. Use only after explicit questionnaire approval.",
		promptSnippet: "Persist approved durable/project-profile proposals after explicit questionnaire approval.",
		promptGuidelines: [
			"Use this tool only after the user has approved durable memory or profile changes via questionnaire.",
			"Pass exact evidence paths and set action to approve, queue, or reject for each durable/profile proposal.",
		],
		parameters: MemoryProposalToolParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paths = await resolveMemoryPaths(ctx.cwd);
			const result = await applyMemoryProposalActions(paths, params.actions.map((action) => ({
				...action,
				section: action.section as never,
				derivedFrom: action.derivedFrom ?? [],
			})));
			state.paths = paths;
			await refreshBaseState(state, ctx.cwd);
			sendBasePackageIfNeeded(pi, ctx, state);
			updateStatus(ctx, state);
			return {
				content: [
					{
						type: "text",
						text: [
							"Applied memory proposals.",
							`Approved: ${result.approved}`,
							`Queued: ${result.queued}`,
							`Rejected: ${result.rejected}`,
							`Pending remaining: ${result.pendingCount}`,
							`Changed paths: ${result.changedPaths.join(", ") || "none"}`,
						].join("\n"),
					},
				],
				details: result,
			};
		},
	});

	pi.on("session_start", async (event, ctx) => {
		state.taskPackage = undefined;
		state.lastPrompt = undefined;
		if (IS_SUBAGENT) {
			state.basePackage = undefined;
			state.paths = undefined;
			state.preservedCompactionState = undefined;
			return;
		}
		state.preservedCompactionState = loadLatestMemoryCompactionState(ctx.sessionManager.getBranch() as Array<{ type?: string; details?: unknown }>);
		await refreshBaseState(state, ctx.cwd);
		if (!state.basePackage || !state.paths) return;

		const pendingState = await loadPendingLearnings(state.paths.pendingLearningsPath);
		const pendingLearningSummary = pendingState ? summarizePendingLearnings(pendingState) : undefined;
		let autoDispatchedPendingReview = false;
		if (ctx.hasUI && pendingLearningSummary && pendingLearningSummary.total > 0) {
			ctx.ui.notify(
				`Pending learnings: ${pendingLearningSummary.total} queued (${pendingLearningSummary.scheduledCount} scheduled, ${pendingLearningSummary.manualCount} manual). Review with /learn and approve via questionnaire before persistence.`,
				"info",
			);
		}

		const pendingMemoryProposals = await loadPendingMemoryProposals(state.paths.pendingMemoryProposalsPath);
		const pendingMemorySummary = pendingMemoryProposals ? summarizePendingMemoryProposals(pendingMemoryProposals) : undefined;
		if (ctx.hasUI && pendingMemorySummary && pendingMemorySummary.total > 0) {
			ctx.ui.notify(
				`Pending durable/profile proposals: ${pendingMemorySummary.total} queued. Review via /learn or questionnaire before persistence.`,
				"info",
			);
		}

		const availableCommandNames = pi.getCommands().map((command) => command.name);
		autoDispatchedPendingReview = shouldAutoDispatchPendingReview({
			hasUI: ctx.hasUI,
			reason: event.reason,
			pendingLearningCount: pendingLearningSummary?.total ?? 0,
			pendingMemoryProposalCount: pendingMemorySummary?.total ?? 0,
			availableCommandNames,
		});
		if (autoDispatchedPendingReview) {
			const reviewPaths = [
				...(pendingLearningSummary && pendingLearningSummary.total > 0 ? [state.paths.pendingLearningsPath] : []),
				...(pendingMemorySummary && pendingMemorySummary.total > 0 ? [state.paths.pendingMemoryProposalsPath] : []),
			];
			pi.sendUserMessage(buildPendingReviewPrompt(reviewPaths));
		}

		if (!autoDispatchedPendingReview) {
			sendBasePackageIfNeeded(pi, ctx, state);
		}
		updateStatus(ctx, state);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (IS_SUBAGENT) return undefined;
		if (!state.paths || !state.basePackage) {
			state.preservedCompactionState = loadLatestMemoryCompactionState(ctx.sessionManager.getBranch() as Array<{ type?: string; details?: unknown }>);
			await refreshBaseState(state, ctx.cwd);
		}
		if (!state.paths || !state.basePackage) return undefined;

		const excluded = new Set(state.basePackage.diagnostics.selected.map((snippet) => snippet.dedupeKey));
		state.lastPrompt = event.prompt;
		state.taskPackage = await buildTaskContextPackage(state.paths, event.prompt, {
			excludeDedupeKeys: excluded,
			preservedCompactionState: state.preservedCompactionState,
		});
		updateStatus(ctx, state);
		return undefined;
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (IS_SUBAGENT) return;
		if (!state.lastPrompt?.startsWith("/learn review ")) return;
		await refreshBaseState(state, ctx.cwd);
		sendBasePackageIfNeeded(pi, ctx, state);
		updateStatus(ctx, state);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		if (IS_SUBAGENT) return undefined;
		const paths = state.paths ?? (await resolveMemoryPaths(ctx.cwd));
		const result = await buildMemoryCompactionResult({
			paths,
			preparation: event.preparation,
			prompt: state.lastPrompt,
		});
		state.preservedCompactionState = result.details;
		return { compaction: result };
	});

	pi.on("session_compact", async (event) => {
		if (IS_SUBAGENT) return;
		if (loadLatestMemoryCompactionState([{ type: "compaction", details: event.compactionEntry.details }])) {
			state.preservedCompactionState = loadLatestMemoryCompactionState([
				{ type: "compaction", details: event.compactionEntry.details },
			]);
		}
	});

	pi.on("context", async (event) => {
		if (IS_SUBAGENT || !state.taskPackage || state.taskPackage.diagnostics.selected.length === 0) return undefined;
		const alreadyInjected = event.messages.some((message) => {
			const candidate = message as { role?: string; customType?: string; details?: { hash?: string } };
			return candidate.role === "custom" && candidate.customType === TASK_MESSAGE_TYPE && candidate.details?.hash === state.taskPackage?.hash;
		});
		if (alreadyInjected) return undefined;
		return {
			messages: [
				...event.messages,
				{
					role: "custom",
					customType: TASK_MESSAGE_TYPE,
					content: state.taskPackage.content,
					display: false,
					details: {
						hash: state.taskPackage.hash,
						diagnostics: state.taskPackage.diagnostics,
						prompt: state.lastPrompt,
					},
					timestamp: Date.now(),
				},
			],
		};
	});

	pi.registerCommand("memory-status", {
		description: "Show selected memory artifacts, token budgets, and skipped sources. Optional args simulate a task prompt.",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			state.preservedCompactionState = loadLatestMemoryCompactionState(ctx.sessionManager.getBranch() as Array<{ type?: string; details?: unknown }>);
			await refreshBaseState(state, ctx.cwd);
			if (!state.paths || !state.basePackage) return;
			const prompt = args.trim() || state.lastPrompt;
			const taskPackage = prompt
				? await buildTaskContextPackage(state.paths, prompt, {
					excludeDedupeKeys: new Set(state.basePackage.diagnostics.selected.map((snippet) => snippet.dedupeKey)),
					preservedCompactionState: state.preservedCompactionState,
				})
				: undefined;
			state.taskPackage = taskPackage;
			if (prompt) state.lastPrompt = prompt;
			const report = formatMemoryStatusReport(state.paths, state.basePackage, taskPackage);
			updateStatus(ctx, state);

			if (!ctx.hasUI) {
				console.log(report);
				return;
			}

			ctx.ui.notify(report, "info");
		},
	});
}
