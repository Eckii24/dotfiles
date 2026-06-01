/**
 * RTK Rewrite Extension
 *
 * Intercepts bash tool calls and rewrites supported commands through RTK
 * (Rust Token Killer) for 60-90% token savings on command output.
 *
 * Uses `rtk rewrite` as the single source of truth for what gets rewritten,
 * so this extension automatically supports all commands RTK handles without
 * maintaining a separate command list.
 *
 * Exit codes from `rtk rewrite`:
 *   0 — fully rewritten (use rewritten command)
 *   3 — partially rewritten (use rewritten command, e.g. pipes/chains)
 *   1 — no rewrite available (pass through unchanged)
 */

import { execFileSync, execSync } from "node:child_process";
import { isToolCallEventType, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

let rtkAvailable: boolean | null = null;

function checkRtk(): boolean {
	if (rtkAvailable !== null) return rtkAvailable;
	try {
		execSync("rtk --version", { stdio: "pipe", timeout: 3000 });
		rtkAvailable = true;
	} catch {
		rtkAvailable = false;
	}
	return rtkAvailable;
}

function tryRewrite(command: string): string | null {
	try {
		const result = execFileSync("rtk", ["rewrite", command], {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 3000,
			env: { ...process.env, NO_COLOR: "1" },
		});
		const rewritten = result.toString().trim();
		return rewritten || null;
	} catch (err: any) {
		// Exit code 3 = partial rewrite (pipes/chains) — still use output
		if (err.status === 3 && err.stdout) {
			const rewritten = err.stdout.toString().trim();
			return rewritten || null;
		}
		// Exit code 1 = no rewrite available
		return null;
	}
}

/**
 * Commands that should never be rewritten even if RTK supports them.
 * These are used for side-effects where we need exact output, or are
 * interactive / control-flow commands.
 */
function shouldSkip(command: string): boolean {
	const trimmed = command.trim();

	// Skip multiline scripts (heredocs, complex scripts)
	if (trimmed.includes("\n") && trimmed.split("\n").length > 3) return true;

	// Skip if command starts with rtk already
	if (trimmed.startsWith("rtk ")) return true;

	// Skip variable assignments, functions, control flow
	if (/^(export |[A-Z_]+=|function |if |for |while |case )/.test(trimmed)) return true;

	return false;
}

export default function rtkRewrite(pi: ExtensionAPI, ctx: ExtensionContext) {
	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!checkRtk()) return;

		const command = event.input.command;
		if (!command || shouldSkip(command)) return;

		const rewritten = tryRewrite(command);
		if (rewritten && rewritten !== command) {
			event.input.command = rewritten;
		}
	});
}
