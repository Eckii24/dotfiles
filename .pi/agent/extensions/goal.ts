/**
 * Goal Extension
 *
 * Condition-driven autonomous execution loop inspired by Claude Code's /goal.
 * Sets a completion condition, and the agent keeps working across turns until
 * a separate evaluator sub-agent confirms the condition is met.
 *
 * The evaluator is a full sub-agent with tool access that can independently
 * verify the goal condition (run tests, read files, etc.) rather than just
 * trusting the working model's transcript.
 *
 * Usage:
 *   /goal <condition>   - Set a goal and start working immediately
 *   /goal               - Open configuration dialog (or show status if goal active)
 *   /goal clear         - Clear the active goal
 *   /goal status        - Show current goal status
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER,
	type Focusable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

// ── Constants ────────────────────────────────────────────────────────

const GOAL_STATE_ENTRY_TYPE = "goal-state";
const GOAL_GLOBAL_STATE_KEY = "__piGoalGlobalState";
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_EVALUATOR_MODEL = "github-copilot/claude-haiku-4.5";
const DIRTY_REPO_GUARD_BYPASS_EVENT = "dirty-repo-guard:bypass";

const VERDICT_REGEX =
	/\[GOAL_VERDICT\]\s*MET:\s*(YES|NO)\s*REASON:\s*([\s\S]*?)\s*\[\/GOAL_VERDICT\]/i;

const SETTINGS_PATH_GLOBAL = path.join(os.homedir(), ".pi", "agent", "settings.json");

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

// ── Types ────────────────────────────────────────────────────────────

type GoalStatus = "active" | "evaluating" | "met" | "cleared" | "paused";

type GoalState = {
	version: 1;
	goalId: string;
	condition: string;
	maxTurns: number;
	currentTurn: number;
	evaluatorModel: string;
	status: GoalStatus;
	lastEvalReason?: string;
	useFreshSession: boolean;
	parentSession?: string;
};

type GoalOptions = {
	condition: string;
	maxTurns: number;
	evaluatorModel: string;
	useFreshSession: boolean;
};

type EvaluationResult = {
	met: boolean;
	reason: string;
};

type GoalGlobalState = {
	activeGoalId?: string;
	evaluatorProcess?: ChildProcessWithoutNullStreams;
	abortEvaluation?: () => void;
	sessionControl?: {
		goalId: string;
		parentSession?: string;
		control: GoalSessionControl;
	};
	handoffGoalId?: string;
};

type GoalSessionControl = Pick<
	ExtensionCommandContext,
	"newSession" | "waitForIdle" | "isIdle" | "hasPendingMessages"
>;

// ── Settings helpers ─────────────────────────────────────────────────

type GoalSettings = {
	evaluatorModel?: string;
	maxTurns?: number;
};

function readSettings(): GoalSettings {
	// Try project-level settings first
	const projectPath = path.join(process.cwd(), ".pi", "settings.json");
	for (const p of [projectPath, SETTINGS_PATH_GLOBAL]) {
		try {
			const raw = fs.readFileSync(p, "utf-8");
			const data = JSON.parse(raw);
			if (data?.goal && typeof data.goal === "object") {
				return data.goal as GoalSettings;
			}
		} catch {
			// file doesn't exist or invalid JSON
		}
	}
	return {};
}

function writeGoalSettings(settings: GoalSettings): void {
	try {
		let data: Record<string, unknown> = {};
		try {
			const raw = fs.readFileSync(SETTINGS_PATH_GLOBAL, "utf-8");
			data = JSON.parse(raw);
		} catch {
			// fresh settings
		}
		data.goal = { ...(data.goal as GoalSettings | undefined), ...settings };
		fs.writeFileSync(SETTINGS_PATH_GLOBAL, JSON.stringify(data, null, 2) + "\n", "utf-8");
	} catch {
		// ignore write failures
	}
}

// ── Process helpers ──────────────────────────────────────────────────

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };
	return { command: "pi", args };
}

// ── Global state ─────────────────────────────────────────────────────

function getGlobalState(): GoalGlobalState {
	const g = globalThis as typeof globalThis & {
		[GOAL_GLOBAL_STATE_KEY]?: GoalGlobalState;
	};
	if (!g[GOAL_GLOBAL_STATE_KEY]) g[GOAL_GLOBAL_STATE_KEY] = {};
	return g[GOAL_GLOBAL_STATE_KEY]!;
}

function setGoalSessionControl(ctx: ExtensionCommandContext, state: GoalState): void {
	getGlobalState().sessionControl = {
		goalId: state.goalId,
		parentSession: state.parentSession,
		control: {
			newSession: ctx.newSession,
			waitForIdle: ctx.waitForIdle,
			isIdle: ctx.isIdle,
			hasPendingMessages: ctx.hasPendingMessages,
		},
	};
}

function getGoalSessionControl(state?: Pick<GoalState, "goalId">): GoalSessionControl | undefined {
	const stored = getGlobalState().sessionControl;
	if (!stored) return undefined;
	if (state && stored.goalId !== state.goalId) return undefined;
	return stored.control;
}

function clearGoalSessionControl(goalId: string): void {
	const globalState = getGlobalState();
	if (globalState.sessionControl?.goalId === goalId) {
		globalState.sessionControl = undefined;
	}
	if (globalState.handoffGoalId === goalId) {
		globalState.handoffGoalId = undefined;
	}
}

function markGoalHandoff(goalId: string, active: boolean): void {
	const globalState = getGlobalState();
	if (active) {
		globalState.handoffGoalId = goalId;
	} else if (globalState.handoffGoalId === goalId) {
		globalState.handoffGoalId = undefined;
	}
}

// ── State persistence helpers ────────────────────────────────────────

function getLatestGoalState(ctx: ExtensionContext): GoalState | undefined {
	const entries = ctx.sessionManager.getBranch() as Array<{
		type: string;
		customType?: string;
		data?: unknown;
	}>;
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e.type !== "custom" || e.customType !== GOAL_STATE_ENTRY_TYPE) continue;
		if (isGoalState(e.data)) return e.data;
	}
	return undefined;
}

function isGoalState(value: unknown): value is GoalState {
	if (!value || typeof value !== "object") return false;
	const s = value as Partial<GoalState>;
	return (
		s.version === 1 &&
		typeof s.goalId === "string" &&
		typeof s.condition === "string" &&
		typeof s.maxTurns === "number" &&
		typeof s.currentTurn === "number" &&
		typeof s.evaluatorModel === "string" &&
		typeof s.useFreshSession === "boolean" &&
		typeof s.status === "string"
	);
}

// ── Evaluator ────────────────────────────────────────────────────────

function buildEvaluatorPrompt(
	condition: string,
	lastTurnContext: string,
	priorReason?: string,
): string {
	const parts: string[] = [];
	parts.push("## Goal Condition");
	parts.push(condition);
	parts.push("");
	parts.push("## Last Turn Summary");
	parts.push(lastTurnContext || "(no context available)");
	if (priorReason) {
		parts.push("");
		parts.push("## Prior Evaluation");
		parts.push(priorReason);
	}
	parts.push("");
	parts.push("Verify whether the goal condition above is met. Use tools to check independently.");
	parts.push("Do NOT modify anything. Never edit files, write files, create files, or make changes.");
	parts.push("Be decisive. If uncertain, return NO and explain what remains.");
	parts.push("");
	parts.push("You MUST end your response with exactly this block:");
	parts.push("[GOAL_VERDICT]");
	parts.push("MET: YES or NO");
	parts.push("REASON: One or two sentences explaining why the condition is or is not met.");
	parts.push("[/GOAL_VERDICT]");
	return parts.join("\n");
}

function extractLastTurnContext(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getBranch() as Array<{
		type: string;
		message?: { role?: string; content?: unknown; stopReason?: string };
	}>;

	const parts: string[] = [];
	let foundAssistant = false;

	// Walk backward to find the last user+assistant pair
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;

		if (!foundAssistant && entry.message?.role === "assistant") {
			foundAssistant = true;
			const text = extractMessageText(entry.message);
			if (text) parts.unshift(`Assistant: ${text}`);
			continue;
		}

		if (foundAssistant && entry.message?.role === "user") {
			const text = extractMessageText(entry.message);
			if (text) parts.unshift(`User: ${text}`);
			break;
		}
	}

	// Truncate to ~8000 chars to keep evaluator context reasonable
	const combined = parts.join("\n\n");
	return combined.length > 8000 ? combined.slice(0, 8000) + "\n...(truncated)" : combined;
}

function extractMessageText(message: {
	content?: unknown;
	role?: string;
}): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block: unknown): block is { type: string; text: string } =>
				typeof block === "object" &&
				block !== null &&
				(block as any).type === "text" &&
				typeof (block as any).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

async function runEvaluator(
	cwd: string,
	evaluatorModel: string,
	prompt: string,
	signal?: AbortSignal,
): Promise<EvaluationResult> {
	return new Promise<EvaluationResult>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Evaluation aborted"));
			return;
		}

		const args = [
			"-p",
			prompt,
			"--model",
			evaluatorModel,
			"--no-session",
			"--thinking-level",
			"off",
		];

		const invocation = getPiInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, PI_SUBAGENT: "1" },
		});

		const globalState = getGlobalState();
		globalState.evaluatorProcess = proc;
		globalState.abortEvaluation = () => {
			if (!proc.killed) proc.kill("SIGTERM");
		};

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		const onAbort = () => {
			if (!proc.killed) proc.kill("SIGTERM");
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		proc.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			globalState.evaluatorProcess = undefined;
			globalState.abortEvaluation = undefined;

			if (signal?.aborted) {
				reject(new Error("Evaluation aborted"));
				return;
			}

			if (code !== 0) {
				reject(
					new Error(
						`Evaluator exited with code ${code}: ${stderr.slice(0, 500)}`,
					),
				);
				return;
			}

			const verdict = parseVerdict(stdout);
			if (verdict) {
				resolve(verdict);
			} else {
				resolve({
					met: false,
					reason: `Evaluator did not return a structured verdict. Output: ${stdout.slice(0, 500)}`,
				});
			}
		});

		proc.on("error", (error) => {
			signal?.removeEventListener("abort", onAbort);
			globalState.evaluatorProcess = undefined;
			globalState.abortEvaluation = undefined;
			reject(error);
		});
	});
}

function parseVerdict(output: string): EvaluationResult | undefined {
	const match = output.match(VERDICT_REGEX);
	if (!match) return undefined;
	return {
		met: match[1]!.toUpperCase() === "YES",
		reason: match[2]!.trim(),
	};
}

function buildGoalWorkPrompt(condition: string): string {
	return `Goal: ${condition}\n\nWork toward this goal. When you believe it is complete, describe what you did and the evidence of completion.`;
}

function buildGoalContinuationPrompt(
	state: GoalState,
	evalReason: string,
	prefix = "The evaluator determined the goal is NOT yet met.",
): string {
	return [
		prefix,
		"",
		`Goal: ${state.condition}`,
		"",
		`Evaluator feedback: ${evalReason}`,
		"",
		`Iteration ${state.currentTurn} of ${state.maxTurns}. Continue working toward the goal. Address the evaluator's feedback.`,
	].join("\n");
}

// ── Status display ───────────────────────────────────────────────────

function updateStatus(ctx: ExtensionContext, state: GoalState): void {
	if (!ctx.hasUI) return;

	if (
		state.status === "met" ||
		state.status === "cleared"
	) {
		ctx.ui.setStatus("goal", undefined);
		return;
	}

	const condPreview =
		state.condition.length > 40
			? state.condition.slice(0, 37) + "..."
			: state.condition;

	let statusText: string;
	switch (state.status) {
		case "active":
			statusText = `◎ Goal [${state.currentTurn}/${state.maxTurns}] ${condPreview}`;
			break;
		case "evaluating":
			statusText = `◎ Goal [${state.currentTurn}/${state.maxTurns}] evaluating… ${condPreview}`;
			break;
		case "paused":
			statusText = `◎ Goal [${state.currentTurn}/${state.maxTurns}] paused — ${state.lastEvalReason ?? "evaluator error"}`;
			break;
		default:
			statusText = `◎ Goal ${condPreview}`;
	}

	ctx.ui.setStatus(
		"goal",
		ctx.ui.theme.fg("accent", statusText),
	);
}

function clearStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("goal", undefined);
}

// ── Model picker ─────────────────────────────────────────────────────

async function pickEvaluatorModel(ctx: ExtensionContext): Promise<string | undefined> {
	if (!ctx.hasUI) return DEFAULT_EVALUATOR_MODEL;

	const available = ctx.modelRegistry.getAvailable();
	if (available.length === 0) return DEFAULT_EVALUATOR_MODEL;

	const options = available.map((m) => `${m.provider}/${m.id}`);
	const choice = await ctx.ui.select("Select evaluator model:", options);
	return choice ?? undefined;
}

// ── Extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let latestCtx: ExtensionContext | undefined;

	pi.registerCommand("goal", {
		description:
			"Set a goal condition — agent works autonomously until an evaluator sub-agent confirms it's met",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			const currentState = getLatestGoalState(ctx);
			const isActive =
				currentState &&
				(currentState.status === "active" ||
					currentState.status === "evaluating");
			const hasGoal =
				currentState &&
				(currentState.status === "active" ||
					currentState.status === "evaluating" ||
					currentState.status === "paused");

			// /goal clear
			if (CLEAR_ALIASES.has(trimmed.toLowerCase())) {
				if (!hasGoal) {
					ctx.ui.notify("No active goal to clear", "info");
					return;
				}
				clearGoal(pi, ctx, currentState!);
				ctx.ui.notify("Goal cleared", "info");
				return;
			}

			// /goal status (or /goal with no args when goal is active)
			if (trimmed.toLowerCase() === "status" || (trimmed === "" && hasGoal)) {
				if (!hasGoal) {
					ctx.ui.notify("No active goal", "info");
					return;
				}
				showGoalStatus(ctx, currentState!);
				return;
			}

			// If a goal is already active and args are provided, replace it
			if (isActive && trimmed) {
				clearGoal(pi, ctx, currentState!);
			}

			// /goal with no args and no active goal → open dialog
			if (!trimmed) {
				const settings = readSettings();
				pi.events.emit("notify:input-needed", {
					message: "Goal — configuration needed",
				});

				const result = await ctx.ui.custom<GoalOptions | null>(
					(_tui, theme, _kb, done) =>
						new GoalDialog(theme, done, {
							maxTurns:
								settings.maxTurns ?? DEFAULT_MAX_TURNS,
							evaluatorModel:
								settings.evaluatorModel ??
								DEFAULT_EVALUATOR_MODEL,
						}),
					{ overlay: true },
				);

				if (!result) {
					ctx.ui.notify("Goal cancelled", "info");
					return;
				}

				if (!result.condition.trim()) {
					ctx.ui.notify("No condition provided", "warning");
					return;
				}

				// If evaluator model was picked, save it
				if (result.evaluatorModel !== (settings.evaluatorModel ?? DEFAULT_EVALUATOR_MODEL)) {
					writeGoalSettings({ evaluatorModel: result.evaluatorModel });
				}

				await startGoal(pi, ctx, result);
				return;
			}

			// /goal <condition> — quick start with defaults
			const settings = readSettings();
			let evaluatorModel = settings.evaluatorModel ?? DEFAULT_EVALUATOR_MODEL;

			// If no evaluator model configured, ask user to pick one
			if (!settings.evaluatorModel) {
				const picked = await pickEvaluatorModel(ctx);
				if (!picked) {
					ctx.ui.notify("Goal cancelled — no evaluator model selected", "info");
					return;
				}
				evaluatorModel = picked;
				writeGoalSettings({ evaluatorModel: picked });
			}

			await startGoal(pi, ctx, {
				condition: trimmed,
				maxTurns: settings.maxTurns ?? DEFAULT_MAX_TURNS,
				evaluatorModel,
				useFreshSession: false,
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;

		// Restore goal state from session
		const state = getLatestGoalState(ctx);
		if (!state) return;

		if (state.status === "active" || state.status === "evaluating") {
			if (state.useFreshSession && !getGoalSessionControl(state)) {
				const paused: GoalState = {
					...state,
					status: "paused",
					lastEvalReason: "Fresh-session control unavailable after reload or resume. Start /goal again to continue autonomously.",
				};
				pi.appendEntry(GOAL_STATE_ENTRY_TYPE, paused);
				updateStatus(ctx, paused);
				return;
			}

			// Restore active goal display
			const restored: GoalState = { ...state, status: "active" };
			pi.appendEntry(GOAL_STATE_ENTRY_TYPE, restored);
			updateStatus(ctx, restored);
		} else if (state.status === "paused") {
			updateStatus(ctx, state);
		}
	});

	pi.on("session_shutdown", async (event) => {
		// Kill any running evaluator
		const globalState = getGlobalState();
		globalState.abortEvaluation?.();
		if (event.reason !== "new" || !globalState.handoffGoalId) {
			globalState.sessionControl = undefined;
			globalState.handoffGoalId = undefined;
		}
		if (latestCtx) clearStatus(latestCtx);
	});

	pi.on("agent_end", async (event, ctx) => {
		latestCtx = ctx;
		const state = getLatestGoalState(ctx);
		if (!state || state.status !== "active") return;

		// Check if the last message was aborted
		const messages = event.messages as Array<{
			role?: string;
			stopReason?: string;
		}>;
		const lastAssistant = [...messages]
			.reverse()
			.find((m) => m.role === "assistant");
		if (lastAssistant?.stopReason === "aborted") {
			clearGoal(pi, ctx, state);
			return;
		}

		// Run evaluator
		await evaluateAndContinue(pi, ctx, state);
	});

	// ── Core loop ────────────────────────────────────────────────────

	async function startGoal(
		pi: ExtensionAPI,
		ctx: ExtensionCommandContext,
		options: GoalOptions,
	): Promise<void> {
		const state: GoalState = {
			version: 1,
			goalId: randomUUID(),
			condition: options.condition,
			maxTurns: options.maxTurns,
			currentTurn: 1,
			evaluatorModel: options.evaluatorModel,
			status: "active",
			useFreshSession: options.useFreshSession,
			parentSession: ctx.sessionManager.getSessionFile(),
		};

		setGoalSessionControl(ctx, state);

		if (state.useFreshSession) {
			const started = await openGoalSessionWithPrompt(pi, ctx, state, undefined);
			if (!started) {
				clearGoalSessionControl(state.goalId);
				if (ctx.hasUI) {
					ctx.ui.notify("Goal cancelled — fresh session was not started", "info");
				}
			}
			return;
		}

		pi.appendEntry(GOAL_STATE_ENTRY_TYPE, state);
		updateStatus(ctx, state);

		// Send the condition as the initial prompt
		pi.sendUserMessage(
			buildGoalWorkPrompt(state.condition),
			{ deliverAs: "followUp" },
		);
	}

	async function evaluateAndContinue(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		state: GoalState,
	): Promise<void> {
		// Mark as evaluating
		const evalState: GoalState = { ...state, status: "evaluating" };
		pi.appendEntry(GOAL_STATE_ENTRY_TYPE, evalState);
		updateStatus(ctx, evalState);

		const lastTurnContext = extractLastTurnContext(ctx);
		const prompt = buildEvaluatorPrompt(
			state.condition,
			lastTurnContext,
			state.lastEvalReason,
		);

		let result: EvaluationResult | undefined;

		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				result = await runEvaluator(
					ctx.cwd,
					state.evaluatorModel,
					prompt,
				);
				break;
			} catch (error) {
				if (attempt === 0) {
					continue;
				}
				// Second failure — pause
				const errorMsg =
					error instanceof Error ? error.message : String(error);
				const pausedState: GoalState = {
					...state,
					status: "paused",
					lastEvalReason: `Evaluator error: ${errorMsg}`,
				};
				pi.appendEntry(GOAL_STATE_ENTRY_TYPE, pausedState);
				updateStatus(ctx, pausedState);
				clearGoalSessionControl(state.goalId);
				if (ctx.hasUI) {
					ctx.ui.notify(
						`Goal paused: evaluator failed after retry — ${errorMsg}`,
						"error",
					);
				}
				return;
			}
		}

		if (!result) return;

		if (result.met) {
			// Goal met — confirm with user
			const metState: GoalState = {
				...state,
				status: "met",
				lastEvalReason: result.reason,
			};

			if (ctx.hasUI) {
				const confirmed = await ctx.ui.confirm(
					"Goal met",
					`${result.reason}\n\nClear the goal?`,
				);
				if (confirmed) {
					pi.appendEntry(GOAL_STATE_ENTRY_TYPE, metState);
					clearStatus(ctx);
					setDirtyRepoGuardBypass(pi, state.goalId, false);
					clearGoalSessionControl(state.goalId);
					ctx.ui.notify("Goal achieved ✓", "info");
				} else {
					// User wants to keep going
					const continueState: GoalState = {
						...state,
						status: "active",
						currentTurn: state.currentTurn + 1,
						lastEvalReason: `Evaluator said met but user chose to continue: ${result.reason}`,
					};
					pi.appendEntry(GOAL_STATE_ENTRY_TYPE, continueState);
					updateStatus(ctx, continueState);
					if (state.useFreshSession) {
						await openNextFreshSession(pi, ctx, continueState, result.reason);
					} else {
						sendContinuationPrompt(pi, continueState, result.reason, true);
					}
				}
			} else {
				// Non-interactive — just clear
				pi.appendEntry(GOAL_STATE_ENTRY_TYPE, metState);
				clearStatus(ctx);
				setDirtyRepoGuardBypass(pi, state.goalId, false);
				clearGoalSessionControl(state.goalId);
			}
			return;
		}

		if (state.currentTurn >= state.maxTurns) {
			const pausedState: GoalState = {
				...state,
				status: "paused",
				lastEvalReason: `Turn limit reached (${state.maxTurns}). Last evaluation: ${result.reason}`,
			};
			pi.appendEntry(GOAL_STATE_ENTRY_TYPE, pausedState);
			updateStatus(ctx, pausedState);
			clearGoalSessionControl(state.goalId);
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Goal paused: turn limit reached (${state.maxTurns})`,
					"warning",
				);
			}
			return;
		}

		// Goal NOT met — continue
		const nextState: GoalState = {
			...state,
			status: "active",
			currentTurn: state.currentTurn + 1,
			lastEvalReason: result.reason,
		};
		pi.appendEntry(GOAL_STATE_ENTRY_TYPE, nextState);
		updateStatus(ctx, nextState);

		if (state.useFreshSession) {
			const control = getGoalSessionControl(state);
			if (!control) {
				const pausedState: GoalState = {
					...nextState,
					status: "paused",
					lastEvalReason: "Fresh-session control unavailable. Start /goal again to continue autonomously.",
				};
				pi.appendEntry(GOAL_STATE_ENTRY_TYPE, pausedState);
				updateStatus(ctx, pausedState);
				clearGoalSessionControl(state.goalId);
				return;
			}

			// Fresh session mode: spawn a new session
			await openNextFreshSession(pi, ctx, nextState, result.reason);
		} else {
			// Same session mode: send continuation message
			sendContinuationPrompt(pi, nextState, result.reason, false);
		}
	}

	function sendContinuationPrompt(
		pi: ExtensionAPI,
		state: GoalState,
		evalReason: string,
		userOverride: boolean,
	): void {
		const prefix = userOverride
			? "The evaluator considered the goal met, but you chose to continue."
			: "The evaluator determined the goal is NOT yet met.";

		pi.sendUserMessage(
			buildGoalContinuationPrompt(state, evalReason, prefix),
			{ deliverAs: "followUp" },
		);
	}

	async function openNextFreshSession(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		nextState: GoalState,
		evalReason: string,
	): Promise<void> {
		const result = await openGoalSessionWithPrompt(pi, ctx, nextState, evalReason);
		if (!result) {
			const pausedState: GoalState = {
				...nextState,
				status: "paused",
				lastEvalReason: "Fresh-session handoff cancelled.",
			};
			pi.appendEntry(GOAL_STATE_ENTRY_TYPE, pausedState);
			updateStatus(ctx, pausedState);
			clearGoalSessionControl(nextState.goalId);
		}
	}

	async function openGoalSessionWithPrompt(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		state: GoalState,
		evalReason: string | undefined,
	): Promise<boolean> {
		const control = getGoalSessionControl(state);
		if (!control) return false;

		setDirtyRepoGuardBypass(pi, state.goalId, true);
		markGoalHandoff(state.goalId, true);

		try {
			const result = await control.newSession({
				...(state.parentSession
					? { parentSession: state.parentSession }
					: {}),
				setup: async (sessionManager) => {
					sessionManager.appendCustomEntry(
						GOAL_STATE_ENTRY_TYPE,
						state,
					);
				},
				withSession: async (freshCtx) => {
					await freshCtx.sendUserMessage(
						evalReason
							? buildGoalContinuationPrompt(state, evalReason)
							: buildGoalWorkPrompt(state.condition),
					);
				},
			});

			markGoalHandoff(state.goalId, false);
			if (result.cancelled) {
				setDirtyRepoGuardBypass(pi, state.goalId, false);
				return false;
			}
			return true;
		} catch (error) {
			markGoalHandoff(state.goalId, false);
			setDirtyRepoGuardBypass(pi, state.goalId, false);
			throw error;
		}
	}

	function clearGoal(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		state: GoalState,
	): void {
		const cleared: GoalState = { ...state, status: "cleared" };
		pi.appendEntry(GOAL_STATE_ENTRY_TYPE, cleared);
		clearStatus(ctx);
		setDirtyRepoGuardBypass(pi, state.goalId, false);
		clearGoalSessionControl(state.goalId);

		// Kill any running evaluator
		const globalState = getGlobalState();
		globalState.abortEvaluation?.();
	}

	function showGoalStatus(ctx: ExtensionContext, state: GoalState): void {
		if (!ctx.hasUI) return;

		const lines = [
			`Condition: ${state.condition}`,
			`Status: ${state.status}`,
			`Turn: ${state.currentTurn}/${state.maxTurns}`,
			`Evaluator: ${state.evaluatorModel}`,
			`Session mode: ${state.useFreshSession ? "fresh" : "same"}`,
		];
		if (state.lastEvalReason) {
			lines.push(`Last evaluation: ${state.lastEvalReason}`);
		}

		ctx.ui.notify(lines.join("\n"), "info");
	}
}

function setDirtyRepoGuardBypass(
	pi: ExtensionAPI,
	token: string,
	active: boolean,
): void {
	pi.events.emit(DIRTY_REPO_GUARD_BYPASS_EVENT, {
		source: "goal",
		token,
		active,
	});
}

// ── Dialog ───────────────────────────────────────────────────────────

class GoalDialog implements Focusable {
	readonly width = 68;
	focused = false;

	private activeField:
		| "condition"
		| "maxTurns"
		| "evaluatorModel"
		| "freshSession" = "condition";

	private conditionText = "";
	private conditionCursor = 0;
	private maxTurnsText: string;
	private maxTurnsCursor: number;
	private evaluatorModelText: string;
	private evaluatorModelCursor: number;
	private useFreshSession = false;

	constructor(
		private theme: Theme,
		private done: (result: GoalOptions | null) => void,
		defaults: { maxTurns: number; evaluatorModel: string },
	) {
		this.maxTurnsText = String(defaults.maxTurns);
		this.maxTurnsCursor = this.maxTurnsText.length;
		this.evaluatorModelText = defaults.evaluatorModel;
		this.evaluatorModelCursor = this.evaluatorModelText.length;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) {
			this.done(null);
			return;
		}

		if (matchesKey(data, "tab")) {
			this.activeField = this.nextField(this.activeField);
			return;
		}

		if (matchesKey(data, "shift+tab")) {
			this.activeField = this.prevField(this.activeField);
			return;
		}

		if (this.activeField === "freshSession") {
			if (matchesKey(data, "space")) {
				this.useFreshSession = !this.useFreshSession;
				return;
			}
			if (matchesKey(data, "return")) {
				this.submit();
				return;
			}
			return;
		}

		if (matchesKey(data, "return")) {
			this.submit();
			return;
		}

		this.handleFieldInput(this.activeField, data);
	}

	private nextField(
		f: typeof this.activeField,
	): typeof this.activeField {
		const order = [
			"condition",
			"maxTurns",
			"evaluatorModel",
			"freshSession",
		] as const;
		const idx = order.indexOf(f);
		return order[(idx + 1) % order.length]!;
	}

	private prevField(
		f: typeof this.activeField,
	): typeof this.activeField {
		const order = [
			"condition",
			"maxTurns",
			"evaluatorModel",
			"freshSession",
		] as const;
		const idx = order.indexOf(f);
		return order[(idx - 1 + order.length) % order.length]!;
	}

	private submit(): void {
		const maxTurns = parseInt(this.maxTurnsText, 10);
		if (!this.conditionText.trim()) return;
		if (isNaN(maxTurns) || maxTurns < 1) return;
		if (!this.evaluatorModelText.trim()) return;
		this.done({
			condition: this.conditionText,
			maxTurns: Math.min(maxTurns, 999),
			evaluatorModel: this.evaluatorModelText,
			useFreshSession: this.useFreshSession,
		});
	}

	private handleFieldInput(
		field: "condition" | "maxTurns" | "evaluatorModel",
		data: string,
	): void {
		const isCondition = field === "condition";
		const isMaxTurns = field === "maxTurns";
		let text = isCondition
			? this.conditionText
			: isMaxTurns
				? this.maxTurnsText
				: this.evaluatorModelText;
		let cursor = isCondition
			? this.conditionCursor
			: isMaxTurns
				? this.maxTurnsCursor
				: this.evaluatorModelCursor;

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
		} else if (
			matchesKey(data, "home") ||
			matchesKey(data, "ctrl+a")
		) {
			cursor = 0;
		} else if (
			matchesKey(data, "end") ||
			matchesKey(data, "ctrl+e")
		) {
			cursor = text.length;
		} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
			if (isMaxTurns && !/^\d$/.test(data)) return;
			text = text.slice(0, cursor) + data + text.slice(cursor);
			cursor++;
		}

		if (isCondition) {
			this.conditionText = text;
			this.conditionCursor = cursor;
		} else if (isMaxTurns) {
			this.maxTurnsText = text;
			this.maxTurnsCursor = cursor;
		} else {
			this.evaluatorModelText = text;
			this.evaluatorModelCursor = cursor;
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

		const row = (content: string) => {
			const clipped = truncateToWidth(content, innerW, "…");
			return th.fg("border", "│") +
				pad(clipped, innerW) +
				th.fg("border", "│");
		};

		const renderInput = (
			text: string,
			cursor: number,
			isActive: boolean,
			placeholder: string,
		) => {
			if (!isActive) {
				return text || th.fg("dim", placeholder);
			}
			const before = text.slice(0, cursor);
			const cursorChar =
				cursor < text.length ? text[cursor]! : " ";
			const after = text.slice(cursor + 1);
			const marker = this.focused ? CURSOR_MARKER : "";
			return `${before}${marker}\x1b[7m${cursorChar}\x1b[27m${after}`;
		};

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(
			row(` ${th.fg("accent", th.bold("◎ Goal"))}`),
		);
		lines.push(
			row(
				` ${th.fg("dim", "Condition-driven autonomous execution with evaluator sub-agent")}`,
			),
		);
		lines.push(row(""));

		// Condition
		const condActive = this.activeField === "condition";
		const condLabel = condActive
			? th.fg("accent", "  Condition:")
			: th.fg("text", "  Condition:");
		lines.push(row(condLabel));
		const condInput = renderInput(
			this.conditionText,
			this.conditionCursor,
			condActive,
			"e.g. all tests pass and lint is clean",
		);
		lines.push(row(`    ${condInput}`));
		lines.push(row(""));

		// Max turns
		const turnsActive = this.activeField === "maxTurns";
		const turnsLabel = turnsActive
			? th.fg("accent", "  Max Turns:")
			: th.fg("text", "  Max Turns:");
		const turnsInput = renderInput(
			this.maxTurnsText,
			this.maxTurnsCursor,
			turnsActive,
			"10",
		);
		lines.push(row(`${turnsLabel} ${turnsInput}`));
		lines.push(row(""));

		// Evaluator model
		const modelActive = this.activeField === "evaluatorModel";
		const modelLabel = modelActive
			? th.fg("accent", "  Evaluator Model:")
			: th.fg("text", "  Evaluator Model:");
		lines.push(row(modelLabel));
		const modelInput = renderInput(
			this.evaluatorModelText,
			this.evaluatorModelCursor,
			modelActive,
			"provider/model-id",
		);
		lines.push(row(`    ${modelInput}`));
		lines.push(
			row(
				`   ${th.fg("dim", "Sub-agent that independently verifies the goal")}`,
			),
		);
		lines.push(row(""));

		// Fresh session checkbox
		const freshActive = this.activeField === "freshSession";
		const freshCheck = this.useFreshSession ? "[x]" : "[ ]";
		const freshLabel = freshActive
			? th.fg(
					"accent",
					`  ${freshCheck} Fresh session per iteration`,
				)
			: th.fg(
					"text",
					`  ${freshCheck} Fresh session per iteration`,
				);
		lines.push(row(freshLabel));
		if (this.useFreshSession) {
			lines.push(
				row(
					`   ${th.fg("dim", "Each iteration runs in a new session")}`,
				),
			);
		} else {
			lines.push(
				row(
					`   ${th.fg("dim", "Reuse current session (Claude Code approach)")}`,
				),
			);
		}
		lines.push(row(""));

		lines.push(
			row(
				` ${th.fg("dim", " Tab switch • Space toggle • Enter start • Esc cancel")}`,
			),
		);
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}
