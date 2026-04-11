/**
 * Ralph Loop Extension
 *
 * Implements the "Ralph Loop" technique (https://ghuntley.com/ralph/) where
 * a coding agent is put in a while loop, receiving the same prompt each
 * iteration. By default, every loop iteration starts from a fresh Pi session
 * so the active chat context resets before the prompt runs again.
 *
 * Named after Ralph Wiggum from The Simpsons — deterministically bad in
 * an undeterministic world.
 *
 * Core idea: `while :; do cat PROMPT.md | coding-agent ; done`
 *
 * Usage:
 *   /ralph <prompt>                  - Run ralph loop with fresh sessions (default 25 iterations)
 *   /ralph --same-session <prompt>   - Legacy behavior: reuse the same session across iterations
 *   /ralph                           - Open overlay dialog to configure the loop
 */

import { randomUUID } from "node:crypto";
import { type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_MAX_LOOPS = 25;
const SAME_SESSION_FLAG = "--same-session";
const DIRTY_REPO_GUARD_BYPASS_EVENT = "dirty-repo-guard:bypass";
const ITERATION_START_TIMEOUT_MS = 5_000;
const ITERATION_START_POLL_MS = 25;
const RALPH_STATE_ENTRY_TYPE = "ralph-loop-state";
const RALPH_GLOBAL_STATE_KEY = "__piRalphLoopGlobalState";

// No existing structured Ralph completion signal was found in this repo or Pi,
// so Ralph uses an explicit marker instead of fuzzy natural-language matching.
const RALPH_DONE_MARKER = "[RALPH_DONE]";

type RalphLoopOptions = {
	prompt: string;
	maxLoops: number;
	useAgentFollowUps: boolean;
	useFreshSessionPerIteration: boolean;
};

type RalphLoopStateStatus = "queued" | "running" | "done" | "aborted";

type RalphLoopState = RalphLoopOptions & {
	version: 1;
	loopId: string;
	iteration: number;
	parentSession?: string;
	status: RalphLoopStateStatus;
};

type RalphIterationOutcome = {
	aborted: boolean;
	done: boolean;
};

type RalphLoopStateRecord = {
	state: RalphLoopState;
	index: number;
};

type AssistantTextMessage = {
	role: "assistant";
	stopReason?: string;
	content: Array<{ type: string; text?: string }>;
};

type RalphSessionControl = Pick<
	ExtensionCommandContext,
	"newSession" | "waitForIdle" | "isIdle" | "hasPendingMessages"
>;

type RalphActiveRuntime = {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
};

type RalphGlobalState = {
	control?: RalphSessionControl;
	runtime?: RalphActiveRuntime;
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ralph", {
		description: "Run a Ralph loop — same prompt, repeated autonomously in fresh sessions by default",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let options: RalphLoopOptions;
			const trimmedArgs = args.trim();

			if (trimmedArgs) {
				options = parseRalphArgs(trimmedArgs);
			} else {
				pi.events.emit("notify:input-needed", { message: "Ralph loop — configuration needed" });

				const result = await ctx.ui.custom<RalphLoopOptions | null>(
					(_tui, theme, _kb, done) => new RalphLoopDialog(theme, done),
					{ overlay: true },
				);

				if (!result) {
					ctx.ui.notify("Ralph loop cancelled", "info");
					return;
				}

				options = result;
			}

			if (!options.prompt.trim()) {
				ctx.ui.notify("No prompt provided", "warning");
				return;
			}

			if (options.useFreshSessionPerIteration) {
				await startFreshSessionRalphLoop(pi, ctx, options);
				return;
			}

			await runSameSessionRalphLoop(pi, ctx, options);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		setActiveRalphRuntime(pi, ctx);

		const currentStateRecord = getLatestRalphStateRecord(ctx);
		const currentState = currentStateRecord?.state;
		if (!currentState?.useFreshSessionPerIteration) return;

		if (!getRalphSessionControl() && (currentState.status === "running" || currentState.status === "queued")) {
			pi.appendEntry(RALPH_STATE_ENTRY_TYPE, { ...currentState, status: "aborted" });
			clearFreshSessionStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify("⚠️ Ralph loop cannot resume automatically after a Pi restart; start /ralph again", "warning");
			}
			return;
		}

		syncFreshSessionStatus(ctx, currentState);
		if (currentState.status !== "running") return;
		if (!currentStateRecord || hasIterationPromptAfterState(ctx, currentStateRecord)) return;

		setTimeout(() => {
			const latestStateRecord = getLatestRalphStateRecord(ctx);
			if (!latestStateRecord) return;
			if (latestStateRecord.state.loopId !== currentState.loopId) return;
			if (latestStateRecord.state.iteration !== currentState.iteration) return;
			if (hasIterationPromptAfterState(ctx, latestStateRecord)) return;
			startFreshIterationInCurrentSession(pi, currentState);
		}, 0);
	});

	pi.on("agent_end", async (event, ctx) => {
		const state = getLatestRalphState(ctx);
		if (!state || !state.useFreshSessionPerIteration || state.status !== "running") return;

		const finalAssistantMessage = getLatestAssistantMessage(event.messages);
		if (!finalAssistantMessage) return;

		const nextBaseState = { ...state };
		const finalAssistantText = getAssistantText(finalAssistantMessage);

		if (finalAssistantMessage.stopReason === "aborted") {
			pi.appendEntry(RALPH_STATE_ENTRY_TYPE, { ...nextBaseState, status: "aborted" });
			clearFreshSessionStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(`🛑 Ralph loop aborted at iteration ${state.iteration}/${state.maxLoops}`, "warning");
			}
			return;
		}

		if (hasRalphDoneSignal(finalAssistantText)) {
			pi.appendEntry(RALPH_STATE_ENTRY_TYPE, { ...nextBaseState, status: "done" });
			clearFreshSessionStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(
					`✅ Ralph loop stopped early at iteration ${state.iteration}/${state.maxLoops} because the assistant emitted ${RALPH_DONE_MARKER}`,
					"info",
				);
			}
			return;
		}

		if (state.iteration >= state.maxLoops) {
			pi.appendEntry(RALPH_STATE_ENTRY_TYPE, { ...nextBaseState, status: "done" });
			clearFreshSessionStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(`✅ Ralph loop completed all ${state.maxLoops} iterations`, "info");
			}
			return;
		}

		const nextState: RalphLoopState = {
			...nextBaseState,
			iteration: state.iteration + 1,
			status: "running",
		};
		await openNextFreshSession(pi, ctx, nextState);
	});
}

function parseRalphArgs(args: string): RalphLoopOptions {
	let remaining = args.trim();
	let useFreshSessionPerIteration = true;

	while (remaining.startsWith(SAME_SESSION_FLAG)) {
		const suffix = remaining.slice(SAME_SESSION_FLAG.length);
		if (suffix.length > 0 && !/^\s/.test(suffix)) break;
		useFreshSessionPerIteration = false;
		remaining = suffix.trimStart();
	}

	return {
		prompt: remaining,
		maxLoops: DEFAULT_MAX_LOOPS,
		useAgentFollowUps: false,
		useFreshSessionPerIteration,
	};
}

function setDirtyRepoGuardBypass(pi: ExtensionAPI, token: string, active: boolean): void {
	pi.events.emit(DIRTY_REPO_GUARD_BYPASS_EVENT, {
		source: "ralph-loop",
		token,
		active,
	});
}

function buildIterationControlPrompt(options: {
	iteration: number;
	maxLoops: number;
	useFreshSessionPerIteration: boolean;
}): string {
	const sessionResetNote = options.useFreshSessionPerIteration
		? "Each iteration starts in a fresh Pi session, so do not rely on prior chat context."
		: "This loop is reusing the same Pi session, so prior chat context may still be visible.";

	return [
		`Ralph loop control message: you are running iteration ${options.iteration} of ${options.maxLoops}.`,
		"The same user task will be sent repeatedly until it is finished or the loop limit is reached.",
		sessionResetNote,
		`If the task is fully complete and no further Ralph iteration is needed, include the exact marker ${RALPH_DONE_MARKER} anywhere in your final response.`,
		`Do not emit ${RALPH_DONE_MARKER} unless you are confident the task is actually complete.`,
	].join("\n");
}

function injectIterationControlMessage(
	pi: ExtensionAPI,
	iteration: number,
	maxLoops: number,
	useFreshSessionPerIteration: boolean,
): void {
	pi.sendMessage({
		customType: "ralph-loop-control",
		content: buildIterationControlPrompt({ iteration, maxLoops, useFreshSessionPerIteration }),
		display: true,
		details: {
			iteration,
			maxLoops,
			sessionMode: useFreshSessionPerIteration ? "fresh" : "same",
			doneMarker: RALPH_DONE_MARKER,
		},
	});
}

function getRalphGlobalState(): RalphGlobalState {
	const globalState = globalThis as typeof globalThis & {
		[RALPH_GLOBAL_STATE_KEY]?: RalphGlobalState;
	};

	if (!globalState[RALPH_GLOBAL_STATE_KEY]) {
		globalState[RALPH_GLOBAL_STATE_KEY] = {};
	}

	return globalState[RALPH_GLOBAL_STATE_KEY]!;
}

function setRalphSessionControl(ctx: ExtensionCommandContext): void {
	getRalphGlobalState().control = {
		newSession: ctx.newSession,
		waitForIdle: ctx.waitForIdle,
		isIdle: ctx.isIdle,
		hasPendingMessages: ctx.hasPendingMessages,
	};
}

function getRalphSessionControl(): RalphSessionControl | undefined {
	return getRalphGlobalState().control;
}

function setActiveRalphRuntime(pi: ExtensionAPI, ctx: ExtensionContext): void {
	getRalphGlobalState().runtime = { pi, ctx };
}

function getActiveRalphRuntime(): RalphActiveRuntime | undefined {
	return getRalphGlobalState().runtime;
}

function createInitialRalphState(ctx: ExtensionCommandContext, options: RalphLoopOptions): RalphLoopState {
	return {
		version: 1,
		loopId: randomUUID(),
		iteration: 1,
		parentSession: ctx.sessionManager.getSessionFile(),
		status: "running",
		...options,
	};
}

async function startFreshSessionRalphLoop(pi: ExtensionAPI, ctx: ExtensionCommandContext, options: RalphLoopOptions) {
	setRalphSessionControl(ctx);

	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		ctx.ui.notify("⏳ Waiting for the current turn to finish before starting Ralph loop…", "info");
		await ctx.waitForIdle();
	}

	const sessionModeLabel = "fresh session per iteration";
	const promptModeLabel = options.useAgentFollowUps ? "user first, then hidden trigger messages" : "all user messages";
	ctx.ui.notify(`🔁 Starting Ralph loop (${options.maxLoops} iterations, ${sessionModeLabel}, ${promptModeLabel})`, "info");

	const initialState = createInitialRalphState(ctx, options);
	await openNextFreshSession(pi, ctx, initialState);
}

async function openNextFreshSession(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: RalphLoopState,
): Promise<boolean> {
	const control = getRalphSessionControl();
	if (!control) {
		clearFreshSessionStatus(ctx);
		if (ctx.hasUI) {
			ctx.ui.notify("⚠️ Ralph loop lost its session handoff controller; stopping loop", "warning");
		}
		return false;
	}

	syncFreshSessionStatus(ctx, state);
	setDirtyRepoGuardBypass(pi, state.loopId, true);

	try {
		const result = await control.newSession({
			...(state.parentSession ? { parentSession: state.parentSession } : {}),
			setup: async (sessionManager) => {
				sessionManager.appendCustomEntry(RALPH_STATE_ENTRY_TYPE, state);
			},
		});
		if (result.cancelled) {
			setDirtyRepoGuardBypass(pi, state.loopId, false);
			clearFreshSessionStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(`🛑 Ralph loop cancelled before iteration ${state.iteration}/${state.maxLoops}`, "warning");
			}
			return false;
		}
		const activeRuntime = getActiveRalphRuntime();
		if (activeRuntime) {
			const stateRecord = getLatestRalphStateRecord(activeRuntime.ctx);
			syncFreshSessionStatus(activeRuntime.ctx, state);
			if (!stateRecord || !hasIterationPromptAfterState(activeRuntime.ctx, stateRecord)) {
				startFreshIterationInCurrentSession(activeRuntime.pi, state);
			}
		}
		return true;
	} catch (error) {
		setDirtyRepoGuardBypass(pi, state.loopId, false);
		throw error;
	}
}

function startFreshIterationInCurrentSession(pi: ExtensionAPI, state: RalphLoopState): void {
	const isAgentFollowUpIteration = state.useAgentFollowUps && state.iteration > 1;

	injectIterationControlMessage(pi, state.iteration, state.maxLoops, true);
	if (isAgentFollowUpIteration) {
		pi.sendMessage(
			{
				customType: "ralph-loop",
				content: state.prompt,
				display: false,
				details: {
					iteration: state.iteration,
					mode: "agent-followup",
					sessionMode: "fresh",
					loopId: state.loopId,
				},
			},
			{ triggerTurn: true, deliverAs: "followUp" },
		);
		return;
	}

	pi.sendUserMessage(state.prompt);
}

function syncFreshSessionStatus(ctx: ExtensionContext, state: RalphLoopState): void {
	if (!ctx.hasUI) return;

	if (state.status === "done" || state.status === "aborted") {
		clearFreshSessionStatus(ctx);
		return;
	}

	const statusText =
		state.status === "queued"
			? "starting fresh session…"
			: state.useAgentFollowUps && state.iteration > 1
				? "fresh session, working with hidden trigger message…"
				: "fresh session, working…";

	ctx.ui.setStatus("ralph-loop", ctx.ui.theme.fg("accent", `🔁 Ralph [${state.iteration}/${state.maxLoops}] ${statusText}`));
}

function clearFreshSessionStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("ralph-loop", undefined);
}

function getLatestRalphState(ctx: ExtensionContext): RalphLoopState | undefined {
	return getLatestRalphStateRecord(ctx)?.state;
}

function getLatestRalphStateRecord(ctx: ExtensionContext): RalphLoopStateRecord | undefined {
	return getLatestRalphStateRecordFromEntries(
		ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>,
	);
}

function getLatestRalphStateRecordFromEntries(
	entries: Array<{ type: string; customType?: string; data?: unknown }>,
): RalphLoopStateRecord | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== RALPH_STATE_ENTRY_TYPE) continue;
		if (isRalphLoopState(entry.data)) {
			return { state: entry.data, index: i };
		}
	}
	return;
}

function hasIterationPromptAfterState(ctx: ExtensionContext, stateRecord: RalphLoopStateRecord): boolean {
	const entries = ctx.sessionManager.getEntries() as Array<{
		type: string;
		customType?: string;
		message?: { role?: string };
	}>;

	return entries.slice(stateRecord.index + 1).some((entry) => {
		if (entry.type === "message") {
			return entry.message?.role === "user" || entry.message?.role === "assistant";
		}
		if (entry.type === "custom_message") {
			return entry.customType === "ralph-loop";
		}
		return false;
	});
}

function isRalphLoopState(value: unknown): value is RalphLoopState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<RalphLoopState>;
	return (
		state.version === 1 &&
		typeof state.loopId === "string" &&
		typeof state.prompt === "string" &&
		typeof state.maxLoops === "number" &&
		typeof state.useAgentFollowUps === "boolean" &&
		typeof state.useFreshSessionPerIteration === "boolean" &&
		typeof state.iteration === "number" &&
		(state.parentSession === undefined || typeof state.parentSession === "string") &&
		(state.status === "queued" || state.status === "running" || state.status === "done" || state.status === "aborted")
	);
}

// --- Same-session legacy Ralph loop ---

async function runSameSessionRalphLoop(pi: ExtensionAPI, ctx: ExtensionCommandContext, options: RalphLoopOptions) {
	const { prompt, maxLoops, useAgentFollowUps } = options;
	const clearStatus = () => ctx.ui.setStatus("ralph-loop", undefined);
	const updateStatus = (iteration: number, state: string) => {
		ctx.ui.setStatus("ralph-loop", ctx.ui.theme.fg("accent", `🔁 Ralph [${iteration}/${maxLoops}] ${state}`));
	};
	const promptModeLabel = useAgentFollowUps ? "user first, then hidden trigger messages" : "all user messages";

	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		ctx.ui.notify("⏳ Waiting for the current turn to finish before starting Ralph loop…", "info");
		await ctx.waitForIdle();
	}

	ctx.ui.notify(`🔁 Starting Ralph loop (${maxLoops} iterations, same session (legacy), ${promptModeLabel})`, "info");

	try {
		for (let i = 1; i <= maxLoops; i++) {
			const isAgentFollowUpIteration = useAgentFollowUps && i > 1;
			const workLabel = isAgentFollowUpIteration ? "working with hidden trigger message…" : "working…";
			const branchEntryCountBeforeIteration = ctx.sessionManager.getBranch().length;
			updateStatus(i, workLabel);

			injectIterationControlMessage(pi, i, maxLoops, false);
			if (isAgentFollowUpIteration) {
				pi.sendMessage(
					{
						customType: "ralph-loop",
						content: prompt,
						display: false,
						details: {
							iteration: i,
							mode: "agent-followup",
							sessionMode: "same",
						},
					},
					{ triggerTurn: true, deliverAs: "followUp" },
				);
			} else {
				pi.sendUserMessage(prompt, { deliverAs: "followUp" });
			}

			const iterationStarted = await waitForIterationToFinish(ctx, branchEntryCountBeforeIteration);
			if (!iterationStarted) {
				ctx.ui.notify(`⚠️ Ralph iteration ${i}/${maxLoops} never started; stopping loop`, "warning");
				return;
			}

			const iterationOutcome = getIterationOutcome(ctx, branchEntryCountBeforeIteration);
			if (iterationOutcome.aborted) {
				ctx.ui.notify(`🛑 Ralph loop aborted at iteration ${i}/${maxLoops}`, "warning");
				return;
			}

			updateStatus(i, "done ✓");

			if (iterationOutcome.done && i < maxLoops) {
				ctx.ui.notify(
					`✅ Ralph loop stopped early at iteration ${i}/${maxLoops} because the assistant emitted ${RALPH_DONE_MARKER}`,
					"info",
				);
				return;
			}
		}

		ctx.ui.notify(`✅ Ralph loop completed all ${maxLoops} iterations`, "info");
	} finally {
		clearStatus();
	}
}

async function waitForIterationToFinish(
	ctx: ExtensionCommandContext,
	previousEntryCount: number,
): Promise<boolean> {
	const started = await waitForIterationToStart(ctx, previousEntryCount);
	if (!started) return false;
	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		await ctx.waitForIdle();
	}
	return true;
}

async function waitForIterationToStart(ctx: ExtensionCommandContext, previousEntryCount: number): Promise<boolean> {
	const deadline = Date.now() + ITERATION_START_TIMEOUT_MS;

	while (Date.now() < deadline) {
		if (!ctx.isIdle() || ctx.hasPendingMessages() || hasAssistantMessageSince(ctx, previousEntryCount)) {
			return true;
		}
		await sleep(ITERATION_START_POLL_MS);
	}

	return hasAssistantMessageSince(ctx, previousEntryCount);
}

function hasAssistantMessageSince(ctx: ExtensionCommandContext, previousEntryCount: number): boolean {
	const entries = ctx.sessionManager.getBranch();
	return entries
		.slice(previousEntryCount)
		.some((entry) => entry?.type === "message" && entry.message.role === "assistant");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inspect only the session entries created by the current iteration.
 * This keeps Ralph's control flow scoped to the active loop turn instead of
 * accidentally picking up old assistant messages from the session history.
 */
function getIterationOutcome(ctx: ExtensionCommandContext, previousEntryCount: number): RalphIterationOutcome {
	const entries = ctx.sessionManager.getBranch();
	const iterationEntries = entries.slice(previousEntryCount);
	let latestAssistantText = "";

	for (const entry of iterationEntries) {
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason === "aborted") {
			return { aborted: true, done: false };
		}
		latestAssistantText = getAssistantText(entry.message);
	}

	return {
		aborted: false,
		done: hasRalphDoneSignal(latestAssistantText),
	};
}

function isAssistantTextMessage(message: unknown): message is AssistantTextMessage {
	if (!message || typeof message !== "object") return false;
	const candidate = message as Partial<AssistantTextMessage>;
	return candidate.role === "assistant" && Array.isArray(candidate.content);
}

function getLatestAssistantMessage(messages: readonly unknown[]): AssistantTextMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (isAssistantTextMessage(message)) return message;
	}
	return;
}

function getAssistantText(message: { content: Array<{ type: string; text?: string }> }): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function hasRalphDoneSignal(text: string): boolean {
	return text.includes(RALPH_DONE_MARKER);
}

// --- Overlay Dialog ---

class RalphLoopDialog implements Focusable {
	readonly width = 64;
	focused = false;

	private activeField: "prompt" | "maxLoops" | "freshSession" | "agentFollowUps" = "prompt";
	private promptText = "";
	private promptCursor = 0;
	private maxLoopsText = String(DEFAULT_MAX_LOOPS);
	private maxLoopsCursor = String(DEFAULT_MAX_LOOPS).length;
	private useFreshSessionPerIteration = true;
	private useAgentFollowUps = false;

	constructor(private theme: Theme, private done: (result: RalphLoopOptions | null) => void) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done(null);
			return;
		}

		if (matchesKey(data, "tab")) {
			this.activeField =
				this.activeField === "prompt"
					? "maxLoops"
					: this.activeField === "maxLoops"
						? "freshSession"
						: this.activeField === "freshSession"
							? "agentFollowUps"
							: "prompt";
			return;
		}

		if (matchesKey(data, "shift+tab")) {
			this.activeField =
				this.activeField === "prompt"
					? "agentFollowUps"
					: this.activeField === "maxLoops"
						? "prompt"
						: this.activeField === "freshSession"
							? "maxLoops"
							: "freshSession";
			return;
		}

		if (this.activeField === "freshSession") {
			if (matchesKey(data, "space")) {
				this.useFreshSessionPerIteration = !this.useFreshSessionPerIteration;
				return;
			}
			if (matchesKey(data, "return")) {
				this.submit();
				return;
			}
		}

		if (this.activeField === "agentFollowUps") {
			if (matchesKey(data, "space")) {
				this.useAgentFollowUps = !this.useAgentFollowUps;
				return;
			}
			if (matchesKey(data, "return")) {
				this.submit();
				return;
			}
		}

		if (matchesKey(data, "return")) {
			this.submit();
			return;
		}

		if (this.activeField === "prompt") {
			this.handleFieldInput("prompt", data);
		} else if (this.activeField === "maxLoops") {
			this.handleFieldInput("maxLoops", data);
		}
	}

	private submit(): void {
		const maxLoops = parseInt(this.maxLoopsText, 10);
		if (!this.promptText.trim()) return;
		if (isNaN(maxLoops) || maxLoops < 1) return;
		this.done({
			prompt: this.promptText,
			maxLoops: Math.min(maxLoops, 999),
			useAgentFollowUps: this.useAgentFollowUps,
			useFreshSessionPerIteration: this.useFreshSessionPerIteration,
		});
	}

	private handleFieldInput(field: "prompt" | "maxLoops", data: string): void {
		const isPrompt = field === "prompt";
		let text = isPrompt ? this.promptText : this.maxLoopsText;
		let cursor = isPrompt ? this.promptCursor : this.maxLoopsCursor;

		if (matchesKey(data, "backspace")) {
			if (cursor > 0) {
				text = text.slice(0, cursor - 1) + text.slice(cursor);
				cursor--;
			}
		} else if (matchesKey(data, "delete")) {
			if (cursor < text.length) {
				text = text.slice(0, cursor) + text.slice(cursor + 1);
			}
		} else if (matchesKey(data, "left")) {
			cursor = Math.max(0, cursor - 1);
		} else if (matchesKey(data, "right")) {
			cursor = Math.min(text.length, cursor + 1);
		} else if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
			cursor = 0;
		} else if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
			cursor = text.length;
		} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
			if (!isPrompt && !/^\d$/.test(data)) return;
			text = text.slice(0, cursor) + data + text.slice(cursor);
			cursor++;
		}

		if (isPrompt) {
			this.promptText = text;
			this.promptCursor = cursor;
		} else {
			this.maxLoopsText = text;
			this.maxLoopsCursor = cursor;
		}
	}

	render(_width: number): string[] {
		const w = this.width;
		const th = this.theme;
		const innerW = w - 2;
		const lines: string[] = [];

		const pad = (s: string, targetWidth: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, targetWidth - vis));
		};

		const row = (content: string) => th.fg("border", "│") + pad(content, innerW) + th.fg("border", "│");

		const renderInput = (text: string, cursor: number, isActive: boolean, placeholder: string) => {
			if (!isActive) {
				return text || th.fg("dim", placeholder);
			}
			const before = text.slice(0, cursor);
			const cursorChar = cursor < text.length ? text[cursor]! : " ";
			const after = text.slice(cursor + 1);
			const marker = this.focused ? CURSOR_MARKER : "";
			return `${before}${marker}\x1b[7m${cursorChar}\x1b[27m${after}`;
		};

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(row(` ${th.fg("accent", th.bold("🔁 Ralph Loop"))}`));
		lines.push(row(` ${th.fg("dim", "Fresh Pi session each iteration by default")}`));
		lines.push(row(""));

		// Prompt field
		const promptActive = this.activeField === "prompt";
		const promptLabel = promptActive ? th.fg("accent", "  Prompt:") : th.fg("text", "  Prompt:");
		lines.push(row(promptLabel));
		const promptInput = renderInput(this.promptText, this.promptCursor, promptActive, "Enter your task…");
		lines.push(row(`    ${promptInput}`));
		lines.push(row(""));

		// Max iterations field
		const loopsActive = this.activeField === "maxLoops";
		const loopsLabel = loopsActive ? th.fg("accent", "  Max Iterations:") : th.fg("text", "  Max Iterations:");
		const loopsInput = renderInput(this.maxLoopsText, this.maxLoopsCursor, loopsActive, "25");
		lines.push(row(`${loopsLabel} ${loopsInput}`));
		lines.push(row(""));

		// Fresh session checkbox
		const freshSessionActive = this.activeField === "freshSession";
		const freshSessionCheckbox = this.useFreshSessionPerIteration ? "[x]" : "[ ]";
		const freshSessionLabel = freshSessionActive
			? th.fg("accent", `  ${freshSessionCheckbox} Fresh session per iteration`)
			: th.fg("text", `  ${freshSessionCheckbox} Fresh session per iteration`);
		lines.push(row(freshSessionLabel));
		if (this.useFreshSessionPerIteration) {
			lines.push(row(`   ${th.fg("dim", "Each loop starts with ctx.newSession()")}`));
			lines.push(row(`   ${th.fg("dim", "Prompt runs in a clean Pi context")}`));
		} else {
			lines.push(row(`   ${th.fg("dim", "Legacy mode: reuse the active session")}`));
			lines.push(row(`   ${th.fg("dim", "Context accumulates across iterations")}`));
		}
		lines.push(row(""));

		// Agent follow-ups checkbox
		const followUpsActive = this.activeField === "agentFollowUps";
		const followUpsCheckbox = this.useAgentFollowUps ? "[x]" : "[ ]";
		const followUpsLabel = followUpsActive
			? th.fg("accent", `  ${followUpsCheckbox} Use hidden trigger messages after iter 1`)
			: th.fg("text", `  ${followUpsCheckbox} Use hidden trigger messages after iter 1`);
		lines.push(row(followUpsLabel));
		lines.push(row(`   ${th.fg("dim", "Iter 1 = user message")}`));
		lines.push(
			row(
				`   ${th.fg(
					"dim",
					this.useFreshSessionPerIteration
						? "Iter 2..N = hidden sendMessage() in fresh sessions"
						: "Iter 2..N = hidden sendMessage() + triggerTurn",
				)}`,
			),
		);
		lines.push(row(""));
		lines.push(row(`   ${th.fg("dim", `Early stop marker: ${RALPH_DONE_MARKER}`)}`));
		lines.push(row(""));

		lines.push(row(` ${th.fg("dim", " Tab switch • Space toggle • Enter start • Esc cancel")}`));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}
