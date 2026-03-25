/**
 * Ralph Loop Extension
 *
 * Implements the "Ralph Loop" technique (https://ghuntley.com/ralph/) where
 * a coding agent is put in a while loop, receiving the same prompt each
 * iteration. Each loop, the agent re-reads project state and autonomously
 * picks the most important task to work on.
 *
 * Named after Ralph Wiggum from The Simpsons — deterministically bad in
 * an undeterministic world.
 *
 * Core idea: `while :; do cat PROMPT.md | coding-agent ; done`
 *
 * Usage:
 *   /ralph <prompt>   - Run ralph loop with prompt (default 25 iterations)
 *   /ralph            - Open overlay dialog to specify prompt and max iterations
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { CURSOR_MARKER, type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";

const DEFAULT_MAX_LOOPS = 25;

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ralph", {
		description: "Run a Ralph loop — same prompt, repeated autonomously",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			let prompt: string;
			let maxLoops: number;
			let useAgentFollowUps = false;
			const trimmedArgs = args.trim();

			if (trimmedArgs) {
				prompt = trimmedArgs;
				maxLoops = DEFAULT_MAX_LOOPS;
			} else {
				const result = await ctx.ui.custom<{ prompt: string; maxLoops: number; useAgentFollowUps: boolean } | null>(
					(_tui, theme, _kb, done) => new RalphLoopDialog(theme, done),
					{ overlay: true },
				);

				if (!result) {
					ctx.ui.notify("Ralph loop cancelled", "info");
					return;
				}

				prompt = result.prompt;
				maxLoops = result.maxLoops;
				useAgentFollowUps = result.useAgentFollowUps;
			}

			if (!prompt.trim()) {
				ctx.ui.notify("No prompt provided", "warning");
				return;
			}

			await runRalphLoop(pi, ctx, prompt, maxLoops, useAgentFollowUps);
		},
	});
}

// --- Ralph Loop Logic ---

async function runRalphLoop(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompt: string,
	maxLoops: number,
	useAgentFollowUps: boolean,
) {
	const updateStatus = (iteration: number, state: string) => {
		ctx.ui.setStatus("ralph-loop", ctx.ui.theme.fg("accent", `🔁 Ralph [${iteration}/${maxLoops}] ${state}`));
	};

	const modeLabel = useAgentFollowUps ? "user first, then agent follow-ups" : "all user messages";
	ctx.ui.notify(`🔁 Starting Ralph loop (${maxLoops} iterations, ${modeLabel})`, "info");

	for (let i = 1; i <= maxLoops; i++) {
		updateStatus(i, useAgentFollowUps && i > 1 ? "working as agent…" : "working…");

		// Default Ralph behavior: every iteration is a user message.
		// Optional dialog checkbox: after the first iteration, switch to agent-triggered follow-ups.
		if (useAgentFollowUps && i > 1) {
			pi.sendMessage(
				{
					customType: "ralph-loop",
					content: prompt,
					display: false,
					details: { iteration: i, mode: "agent-followup" },
				},
				{ triggerTurn: true },
			);
		} else {
			pi.sendUserMessage(prompt);
		}
		await ctx.waitForIdle();

		// Check if the user aborted the agent (Ctrl+C) — break the loop
		if (wasAborted(ctx)) {
			ctx.ui.setStatus("ralph-loop", undefined);
			ctx.ui.notify(`🛑 Ralph loop aborted at iteration ${i}/${maxLoops}`, "warning");
			return;
		}

		updateStatus(i, "done ✓");
	}

	ctx.ui.setStatus("ralph-loop", undefined);
	ctx.ui.notify(`✅ Ralph loop completed all ${maxLoops} iterations`, "success");
}

/**
 * Check if the last agent turn was aborted by the user (Ctrl+C).
 * If so, we should stop the loop rather than blindly continuing.
 */
function wasAborted(ctx: ExtensionCommandContext): boolean {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i]!;
		if (entry.type === "message" && entry.message.role === "assistant") {
			return (entry.message as any).stopReason === "aborted";
		}
	}
	return false;
}

// --- Overlay Dialog ---

class RalphLoopDialog implements Focusable {
	readonly width = 64;
	focused = false;

	private activeField: "prompt" | "maxLoops" | "agentFollowUps" = "prompt";
	private promptText = "";
	private promptCursor = 0;
	private maxLoopsText = String(DEFAULT_MAX_LOOPS);
	private maxLoopsCursor = String(DEFAULT_MAX_LOOPS).length;
	private useAgentFollowUps = false;

	constructor(
		private theme: Theme,
		private done: (result: { prompt: string; maxLoops: number; useAgentFollowUps: boolean } | null) => void,
	) {}

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
						: "maxLoops";
			return;
		}

		if (this.activeField === "agentFollowUps") {
			if (matchesKey(data, "space")) {
				this.useAgentFollowUps = !this.useAgentFollowUps;
				return;
			}
			if (matchesKey(data, "return")) {
				const maxLoops = parseInt(this.maxLoopsText, 10);
				if (!this.promptText.trim()) return;
				if (isNaN(maxLoops) || maxLoops < 1) return;
				this.done({
					prompt: this.promptText,
					maxLoops: Math.min(maxLoops, 999),
					useAgentFollowUps: this.useAgentFollowUps,
				});
				return;
			}
		}

		if (matchesKey(data, "return")) {
			const maxLoops = parseInt(this.maxLoopsText, 10);
			if (!this.promptText.trim()) return;
			if (isNaN(maxLoops) || maxLoops < 1) return;
			this.done({
				prompt: this.promptText,
				maxLoops: Math.min(maxLoops, 999),
				useAgentFollowUps: this.useAgentFollowUps,
			});
			return;
		}

		if (this.activeField === "prompt") {
			this.handleFieldInput("prompt", data);
		} else if (this.activeField === "maxLoops") {
			this.handleFieldInput("maxLoops", data);
		}
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
		lines.push(row(` ${th.fg("dim", "Same prompt, repeated autonomously")}`));
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

		// Agent follow-ups checkbox
		const followUpsActive = this.activeField === "agentFollowUps";
		const checkbox = this.useAgentFollowUps ? "[x]" : "[ ]";
		const checkboxLabel = followUpsActive
			? th.fg("accent", `  ${checkbox} Use agent follow-ups after first iteration`)
			: th.fg("text", `  ${checkbox} Use agent follow-ups after first iteration`);
		lines.push(row(checkboxLabel));
		lines.push(row(`   ${th.fg("dim", "Iter 1 = user message")}`));
		lines.push(row(`   ${th.fg("dim", "Iter 2..N = sendMessage() + triggerTurn")}`));
		lines.push(row(""));

		lines.push(row(` ${th.fg("dim", " Tab switch • Space toggle • Enter start • Esc cancel")}`));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}
