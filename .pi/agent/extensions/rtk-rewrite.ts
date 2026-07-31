/**
 * RTK Rewrite Extension for Pi
 *
 * Intercepts Pi `bash` tool calls and delegates command rewriting to
 * `rtk rewrite`. RTK remains the single source of truth for:
 *
 * - supported commands,
 * - shell parsing,
 * - compound commands and pipelines,
 * - environment-variable prefixes,
 * - permission classification,
 * - exclusions from the RTK config.
 *
 * The extension deliberately contains no separate command allowlist or
 * rewrite heuristics. Unsupported or unsafe shell constructs are passed
 * through unchanged by RTK.
 *
 * Exit-code contract of `rtk rewrite`:
 *
 *   0 — rewrite available and RTK permission verdict is `allow`
 *   1 — no rewrite available; execute the original command
 *   2 — RTK deny rule matched; leave the original command to Pi
 *   3 — rewrite available, but permission verdict is `ask` or default
 *
 * Exit codes 0 and 3 both provide the rewritten command on stdout.
 * Mutating the tool input does not bypass Pi's own permission handling.
 *
 * Gondolin:
 *
 * When Gondolin sandboxing is requested, the host-side rewrite is skipped.
 * RTK and its configuration must then exist inside the Gondolin guest.
 *
 * Failure policy:
 *
 * The extension always fails open. Missing RTK, timeouts, cancellation,
 * unsupported commands, or unexpected errors never block the original
 * Pi bash command.
 *
 * Requirements:
 *
 * - `rtk` available on PATH
 * - RTK with support for `rtk rewrite`
 */

import {
	isToolCallEventType,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import { isGondolinSandboxRequested } from "./shared/sandbox-intent.ts";

const REWRITE_TIMEOUT_MS = 2_000;

export default async function rtkRewrite(pi: ExtensionAPI) {
	/*
	 * Probe RTK once when the extension is loaded.
	 *
	 * pi.exec avoids a synchronous child process and does not add the
	 * probe output to the agent context.
	 */
	try {
		const version = await pi.exec("rtk", ["--version"], {
			timeout: REWRITE_TIMEOUT_MS,
		});

		if (version.code !== 0) {
			console.warn(
				"[rtk] Binary not found on PATH; rewrite extension disabled",
			);
			return;
		}
	} catch (error) {
		console.warn(
			"[rtk] Version probe failed; rewrite extension disabled",
			error,
		);
		return;
	}

	pi.on("tool_call", async (event, ctx) => {
		try {
			/*
			 * Gondolin owns command execution and RTK inside the guest.
			 * A host-side rewrite could otherwise execute an RTK helper
			 * outside the intended sandbox boundary.
			 */
			if (isGondolinSandboxRequested()) return;

			if (!isToolCallEventType("bash", event)) return;

			const command = event.input.command;
			if (typeof command !== "string" || command.trim() === "") return;

			/*
			 * Process-wide escape hatch.
			 *
			 * Per-command prefixes such as:
			 *
			 *   RTK_DISABLED=1 dotnet test
			 *
			 * are recognized directly by `rtk rewrite`.
			 */
			if (process.env.RTK_DISABLED === "1") return;

			const result = await pi.exec(
				"rtk",
				["rewrite", command],
				{
					timeout: REWRITE_TIMEOUT_MS,
					signal: ctx.signal,
				},
			);

			if (result.killed) return;

			/*
			 * Exit 0: rewrite + allow
			 * Exit 3: rewrite + ask/default
			 *
			 * Exit 1 and 2 leave the original command untouched.
			 */
			if (result.code !== 0 && result.code !== 3) return;

			const rewritten = result.stdout.trim();

			if (rewritten && rewritten !== command) {
				event.input.command = rewritten;
			}
		} catch (error) {
			/*
			 * RTK is an optimization layer. It must never become a
			 * dependency for executing the original command.
			 */
			console.warn(
				"[rtk] Rewrite failed; using original command",
				error,
			);
		}
	});
}
