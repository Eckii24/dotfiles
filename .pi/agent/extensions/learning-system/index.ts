import type { AgentMessage, ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { LearningInjection, LearningSystemPaths } from "./contracts.js";
import { listAllLearningFiles } from "./scan.js";
import { initializeLearningSystemRuntime, refreshRuntimeState, registerLearningRuntimeTools } from "./runtime.js";

export const MESSAGE_TYPE = "learning-system-learnings";
const SUBAGENT_ENV = "PI_SUBAGENT";
const NOTIFY_INPUT_NEEDED_EVENT = "notify:input-needed";
const NOTIFY_INPUT_RESOLVED_EVENT = "notify:input-resolved";
const RALPH_STATE_ENTRY_TYPE = "ralph-loop-state";
const RALPH_GLOBAL_STATE_KEY = "__piRalphLoopGlobalState";

interface RuntimeState {
	paths?: LearningSystemPaths;
	injection?: LearningInjection;
	lastPrompt?: string;
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

async function refreshState(state: RuntimeState, cwd: string, options: { initializeDirs?: boolean } = {}): Promise<RuntimeState> {
	const snapshot = options.initializeDirs ? await initializeLearningSystemRuntime(cwd) : await refreshRuntimeState(cwd);
	state.paths = snapshot.paths;
	state.injection = snapshot.injection;
	return state;
}

export function buildCustomMessage(injection: LearningInjection, display: boolean) {
	return {
		customType: MESSAGE_TYPE,
		content: injection.content,
		display,
		details: {
			hash: injection.hash,
			totalRefs: injection.totalRefs,
			header: injection.header,
		},
	};
}

function getLatestRalphState(ctx: ExtensionContext): { useFreshSessionPerIteration?: boolean; status?: string } | undefined {
	const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== RALPH_STATE_ENTRY_TYPE) continue;
		if (!entry.data || typeof entry.data !== "object") continue;
		return entry.data as { useFreshSessionPerIteration?: boolean; status?: string };
	}
	return undefined;
}

function getGlobalQuietRalphState(): { useFreshSessionPerIteration?: boolean; status?: string } | undefined {
	const globalState = globalThis as typeof globalThis & {
		[RALPH_GLOBAL_STATE_KEY]?: {
			currentLoopState?: { useFreshSessionPerIteration?: boolean; status?: string };
		};
	};
	return globalState[RALPH_GLOBAL_STATE_KEY]?.currentLoopState;
}

function isQuietRalphSession(ctx: ExtensionContext): boolean {
	const state = getLatestRalphState(ctx) ?? getGlobalQuietRalphState();
	return state?.useFreshSessionPerIteration === true && (state.status === "queued" || state.status === "running");
}

function maybeSendInjection(pi: ExtensionAPI, ctx: ExtensionContext, injection: LearningInjection | undefined): void {
	if (!injection || isQuietRalphSession(ctx)) return;
	if (latestCustomMessageHash(ctx, MESSAGE_TYPE) === injection.hash) return;
	pi.sendMessage(buildCustomMessage(injection, true), { triggerTurn: false });
}

export function renderLearningMessage(
	message: { content?: string; details?: Record<string, unknown> },
	options: { expanded: boolean },
	theme: { fg: (color: string, text: string) => string; bg: (color: string, text: string) => string; bold: (text: string) => string },
) {
	const header = String(message.details?.header ?? "Memory · learnings");
	const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
	const collapsedHint = theme.fg("dim", "(Ctrl+O to expand)");
	const content = options.expanded
		? String(message.content ?? header)
		: `${theme.fg("accent", theme.bold(header))}\n${collapsedHint}`;
	box.addChild(new Text(content, 0, 0));
	return box;
}

async function maybePromptPendingReview(pi: ExtensionAPI, ctx: ExtensionContext, paths: LearningSystemPaths): Promise<void> {
	if (process.env[SUBAGENT_ENV] === "1" || !ctx.hasUI || isQuietRalphSession(ctx)) return;
	const pendingTotal = (await listAllLearningFiles(paths)).filter((learning) => learning.status === "pending").length;
	if (pendingTotal === 0) return;

	pi.events.emit(NOTIFY_INPUT_NEEDED_EVENT, { message: "Pending learnings — confirmation needed" });
	const choice = await (async () => {
		try {
			return await ctx.ui.select(`You have ${pendingTotal} open learning${pendingTotal === 1 ? "" : "s"}. Continue without processing ${pendingTotal === 1 ? "it" : "them"}?`, [
				"Yes, continue without processing",
				"No, review now",
			]);
		} finally {
			pi.events.emit(NOTIFY_INPUT_RESOLVED_EVENT);
		}
	})();
	if (choice === "No, review now") {
		pi.sendUserMessage("/skill:learn review");
	}
}

function buildStatusReport(paths: LearningSystemPaths, injection: LearningInjection, pendingTotal: number): string {
	return [
		"Learning system status",
		`Project root: ${paths.projectRoot}`,
		`Same root: ${paths.sameRoot ? "yes" : "no"}`,
		`Project learnings: ${paths.projectDir}`,
		`Project pending: ${paths.projectPendingDir}`,
		`Global learnings: ${paths.globalDir}`,
		`Global pending: ${paths.globalPendingDir}`,
		`Global AGENTS.md: ${paths.globalAgentsPath}`,
		`Project AGENTS.md: ${paths.projectAgentsPath}`,
		`Approved refs: ${injection.totalRefs}`,
		`Pending refs: ${pendingTotal}`,
		"",
		injection.content,
	].join("\n");
}

export default function learningSystem(pi: ExtensionAPI) {
	const state: RuntimeState = {};

	registerLearningRuntimeTools(pi);
	pi.registerMessageRenderer(MESSAGE_TYPE, (message, options, theme) => renderLearningMessage(message, options, theme));

	pi.on("session_start", async (event, ctx) => {
		state.lastPrompt = undefined;
		await refreshState(state, ctx.cwd, { initializeDirs: true });
		if (!state.paths || !state.injection) return;
		if (event.reason !== "reload") await maybePromptPendingReview(pi, ctx, state.paths);
		maybeSendInjection(pi, ctx, state.injection);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		state.lastPrompt = event.prompt;
		await refreshState(state, ctx.cwd);
		if (!state.injection || state.injection.totalRefs === 0) return undefined;
		return {
			message: buildCustomMessage(state.injection, false),
		};
	});

	pi.on("context", async (event, ctx) => {
		if (!state.injection || !state.paths) await refreshState(state, ctx.cwd);
		const currentHash = state.injection?.totalRefs ? state.injection.hash : undefined;
		let latestIndex = -1;
		for (let index = 0; index < event.messages.length; index += 1) {
			const message = event.messages[index] as AgentMessage & { customType?: string; details?: { hash?: string } };
			if (message.customType !== MESSAGE_TYPE) continue;
			if (currentHash && message.details?.hash === currentHash) latestIndex = index;
		}
		return {
			messages: event.messages.filter((message, index) => {
				const custom = message as AgentMessage & { customType?: string };
				if (custom.customType !== MESSAGE_TYPE) return true;
				if (!currentHash) return false;
				return index === latestIndex;
			}),
		};
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!state.lastPrompt?.startsWith("/skill:learn")) return;
		await refreshState(state, ctx.cwd);
		if (!state.injection) return;
		maybeSendInjection(pi, ctx, state.injection);
	});

	pi.registerCommand("learning-status", {
		description: "Show resolved learning-system paths, approved refs, and pending counts.",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await refreshState(state, ctx.cwd);
			if (!state.paths || !state.injection) return;
			const pendingTotal = (await listAllLearningFiles(state.paths)).filter((learning) => learning.status === "pending").length;
			const report = buildStatusReport(state.paths, state.injection, pendingTotal);
			if (!ctx.hasUI) {
				console.log(report);
				return;
			}
			ctx.ui.notify(report, "info");
		},
	});
}
