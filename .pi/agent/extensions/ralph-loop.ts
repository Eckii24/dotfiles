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
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_MAX_LOOPS = 25;
const SAME_SESSION_FLAG = "--same-session";
const DIRTY_REPO_GUARD_BYPASS_EVENT = "dirty-repo-guard:bypass";

type RalphLoopOptions = {
	prompt: string;
	maxLoops: number;
	useAgentFollowUps: boolean;
	useFreshSessionPerIteration: boolean;
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
				const result = await ctx.ui.custom<RalphLoopOptions | null>((_tui, theme, _kb, done) => new RalphLoopDialog(theme, done), {
					overlay: true,
				});

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

			await runRalphLoop(pi, ctx, options);
		},
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

// --- Ralph Loop Logic ---

async function runRalphLoop(pi: ExtensionAPI, ctx: ExtensionCommandContext, options: RalphLoopOptions) {
	const { prompt, maxLoops, useAgentFollowUps, useFreshSessionPerIteration } = options;
	const clearStatus = () => ctx.ui.setStatus("ralph-loop", undefined);
	const updateStatus = (iteration: number, state: string) => {
		ctx.ui.setStatus("ralph-loop", ctx.ui.theme.fg("accent", `🔁 Ralph [${iteration}/${maxLoops}] ${state}`));
	};
	const sessionModeLabel = useFreshSessionPerIteration ? "fresh session per iteration" : "same session (legacy)";
	const promptModeLabel = useAgentFollowUps ? "user first, then hidden trigger messages" : "all user messages";
	const dirtyRepoGuardBypassToken = useFreshSessionPerIteration ? randomUUID() : undefined;

	if (!ctx.isIdle() || ctx.hasPendingMessages()) {
		ctx.ui.notify("⏳ Waiting for the current turn to finish before starting Ralph loop…", "info");
		await ctx.waitForIdle();
	}

	const parentSession = useFreshSessionPerIteration ? ctx.sessionManager.getSessionFile() : undefined;
	ctx.ui.notify(`🔁 Starting Ralph loop (${maxLoops} iterations, ${sessionModeLabel}, ${promptModeLabel})`, "info");

	if (dirtyRepoGuardBypassToken) {
		setDirtyRepoGuardBypass(pi, dirtyRepoGuardBypassToken, true);
	}

	try {
		for (let i = 1; i <= maxLoops; i++) {
			if (useFreshSessionPerIteration) {
				updateStatus(i, "starting fresh session…");
				const result = await ctx.newSession(parentSession ? { parentSession } : undefined);
				if (result.cancelled) {
					ctx.ui.notify(`🛑 Ralph loop cancelled before iteration ${i}/${maxLoops}`, "warning");
					return;
				}
			}

			const isAgentFollowUpIteration = useAgentFollowUps && i > 1;
			const workLabel = isAgentFollowUpIteration ? "working with hidden trigger message…" : "working…";
			const branchEntryCountBeforeIteration = ctx.sessionManager.getBranch().length;
			updateStatus(i, useFreshSessionPerIteration ? `fresh session, ${workLabel}` : workLabel);

			// Default Ralph behavior now starts each iteration from a fresh session.
			// Low-risk legacy mode can still reuse one session, and the optional
			// hidden trigger-message mode still swaps away from user messages after
			// the first iteration.
			if (isAgentFollowUpIteration) {
				pi.sendMessage(
					{
						customType: "ralph-loop",
						content: prompt,
						display: false,
						details: {
							iteration: i,
							mode: "agent-followup",
							sessionMode: useFreshSessionPerIteration ? "fresh" : "same",
						},
					},
					{ triggerTurn: true },
				);
			} else {
				pi.sendUserMessage(prompt);
			}

			await ctx.waitForIdle();

			// Stop if the user aborted the active session turn (Ctrl+C).
			if (wasAbortedSince(ctx, branchEntryCountBeforeIteration)) {
				ctx.ui.notify(`🛑 Ralph loop aborted at iteration ${i}/${maxLoops}`, "warning");
				return;
			}

			updateStatus(i, "done ✓");
		}

		ctx.ui.notify(`✅ Ralph loop completed all ${maxLoops} iterations`, "info");
	} finally {
		if (dirtyRepoGuardBypassToken) {
			setDirtyRepoGuardBypass(pi, dirtyRepoGuardBypassToken, false);
		}
		clearStatus();
	}
}

/**
 * Check whether the assistant turn started by the current iteration was
 * aborted by the user (Ctrl+C). Older aborted turns should not stop a later
 * iteration, especially in legacy same-session mode.
 */
function wasAbortedSince(ctx: ExtensionCommandContext, previousEntryCount: number): boolean {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= previousEntryCount; i--) {
		const entry = entries[i];
		if (entry?.type === "message" && entry.message.role === "assistant" && entry.message.stopReason === "aborted") {
			return true;
		}
	}
	return false;
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

		lines.push(row(` ${th.fg("dim", " Tab switch • Space toggle • Enter start • Esc cancel")}`));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}
