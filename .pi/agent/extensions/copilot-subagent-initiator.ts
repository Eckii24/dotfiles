/**
 * copilot-subagent-initiator
 *
 * GitHub Copilot tracks whether an LLM call was initiated by a human user or by an
 * agent (a follow-up triggered autonomously).  It uses the `X-Initiator` request header
 * for this: `"user"` deducts from the premium quota; `"agent"` does not.
 *
 * Pi sets this header correctly for the main agent process: when the last message in
 * the conversation history is NOT from the user (i.e. the agent is self-steering), the
 * header is set to `"agent"`.  The problem arises with subagents:
 *
 *   When the main agent spawns `pi` as a subprocess (e.g. via a bash tool call or the
 *   built-in subagent extension tool), that child process starts with a fresh, empty
 *   message history.  Its first LLM call therefore has a `user` message as the last
 *   entry, so `X-Initiator` is always `"user"` — even though the entire invocation
 *   was orchestrated by the parent agent, not a human.
 *
 * This extension fixes that in two cooperating halves that live in the same file.
 * Both halves are always loaded because global extensions auto-load in every pi process.
 *
 * ── PARENT SIDE  (PI_SUBAGENT env var NOT set) ────────────────────────────────────
 *
 *   Intercepts tool calls via the `tool_call` event.
 *
 *   a) `bash` tool — every agent-initiated bash command is patched in-place to export
 *      `PI_SUBAGENT=1` before the command runs.  This deliberately covers not only
 *      direct `pi ...` calls, but also indirect descendants such as `bun script.ts`
 *      or `./wrapper.sh` that later spawn `pi`.  Those child `pi` processes are still
 *      the result of one agent action triggered by one human message, so they must
 *      preserve the subagent initiator semantics.
 *
 *   b) `subagent` tool — the built-in subagent extension now passes `PI_SUBAGENT=1`
 *      explicitly in the child spawn environment, so no parent-process mutation is
 *      needed here.
 *
 * ── SUBAGENT SIDE  (PI_SUBAGENT=1) ───────────────────────────────────────────────
 *
 *   At extension load time (factory function), overrides the three built-in API-type
 *   registry entries used by GitHub Copilot models:
 *
 *     • anthropic-messages
 *     • openai-completions
 *     • openai-responses
 *
 *   Each override is a thin wrapper that calls the real provider stream function but
 *   injects `X-Initiator: agent` into the request options headers — but ONLY when
 *   `model.provider === "github-copilot"`.  All other providers pass through unchanged.
 *
 *   WHY this approach (and not model-remapping):
 *
 *     The earlier approach re-registered github-copilot models in the model registry
 *     with custom api-type names.  The flaw: `ctx.model` (the active model object held
 *     by the agent session) is resolved from the registry BEFORE `session_start` fires.
 *     Re-registering models afterwards updates the registry but not the already-resolved
 *     active model reference.  When `streamSimple(ctx.model, ...)` is called it still
 *     looks up the ORIGINAL api type and the custom wrapper is never reached.
 *
 *     By overriding the api-registry entries directly at factory time, the active model
 *     keeps its original `api` field (e.g. `"anthropic-messages"`), but that registry
 *     slot is now our wrapper.  No model reference update is needed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import type { Context, Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import {
	streamSimpleAnthropic,
	streamSimpleOpenAICompletions,
	streamSimpleOpenAIResponses,
} from "@mariozechner/pi-ai";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Set to "1" in every pi subprocess spawned by the parent agent. */
const SUBAGENT_ENV = "PI_SUBAGENT";

/** Appended to every LLM request made by a subagent. */
const AGENT_INITIATOR_HEADER = { "X-Initiator": "agent" } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function commandAlreadySetsSubagentEnv(cmd: string): boolean {
	const directAssignment = new RegExp(String.raw`(?:^|[;&|]\s*|\benv(?:\s+\S+=\S+)*\s+)${SUBAGENT_ENV}=`);
	const exportAssignment = new RegExp(String.raw`\bexport\s+${SUBAGENT_ENV}=`);
	return directAssignment.test(cmd) || exportAssignment.test(cmd);
}

function withSubagentEnv(cmd: string): string {
	if (commandAlreadySetsSubagentEnv(cmd)) return cmd;
	return `export ${SUBAGENT_ENV}=1\n${cmd}`;
}

/**
 * Wrap SimpleStreamOptions so that `X-Initiator: agent` always takes final
 * precedence over whatever the provider would dynamically compute.
 */
function withAgentInitiator(options?: SimpleStreamOptions): SimpleStreamOptions {
	return {
		...options,
		headers: { ...options?.headers, ...AGENT_INITIATOR_HEADER },
	};
}

// ─── Subagent-side stream wrappers ────────────────────────────────────────────
//
// Each wrapper passes through for non-Copilot models and injects the header
// only when model.provider === "github-copilot".  This is important because
// we are overriding the SHARED api-registry entries (e.g. "anthropic-messages")
// which are also used by vanilla Anthropic models.

function subagentStreamAnthropic(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	if (model.provider !== "github-copilot") return streamSimpleAnthropic(model, context, options);
	return streamSimpleAnthropic(model, context, withAgentInitiator(options));
}

function subagentStreamCompletions(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	if (model.provider !== "github-copilot") return streamSimpleOpenAICompletions(model, context, options);
	return streamSimpleOpenAICompletions(model, context, withAgentInitiator(options));
}

function subagentStreamResponses(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	if (model.provider !== "github-copilot") return streamSimpleOpenAIResponses(model, context, options);
	return streamSimpleOpenAIResponses(model, context, withAgentInitiator(options));
}

// ─── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const isSubagent = process.env[SUBAGENT_ENV] === "1";

	// ── SUBAGENT SIDE ──────────────────────────────────────────────────────────
	if (isSubagent) {
		/**
		 * Override the three built-in api-registry slots used by GitHub Copilot.
		 *
		 * pi.registerProvider() calls made at factory time are queued and flushed
		 * once the runner initialises — before session_start fires.  At that point
		 * our wrappers replace the built-in entries in the global apiProviderRegistry
		 * Map.  Subsequent calls to streamSimple(copilotModel, ...) look up
		 * model.api (e.g. "anthropic-messages") in that Map and get our wrapper,
		 * which injects X-Initiator: agent.
		 *
		 * We use the built-in api-type names as the `api` field so the registry
		 * slots are replaced in-place.  No model objects need to be mutated.
		 */
		pi.registerProvider("_copilot-subagent-anthropic", {
			api: "anthropic-messages" as any,
			streamSimple: subagentStreamAnthropic,
		} as any);

		pi.registerProvider("_copilot-subagent-completions", {
			api: "openai-completions" as any,
			streamSimple: subagentStreamCompletions,
		} as any);

		pi.registerProvider("_copilot-subagent-responses", {
			api: "openai-responses" as any,
			streamSimple: subagentStreamResponses,
		} as any);

		pi.on("session_start", async (_event, ctx) => {
			const hasCopilot = ctx.modelRegistry.getAll().some((m) => m.provider === "github-copilot");
			if (!hasCopilot) return;

			process.stderr.write(
				"[copilot-subagent-initiator] Running as subagent — X-Initiator:agent injected for all Copilot LLM calls\n",
			);
			ctx.ui.notify("[copilot-subagent-initiator] X-Initiator forced to 'agent' for all LLM calls", "info");
		});

		return; // Done for the subagent side.
	}

	// ── PARENT SIDE ─────────────────────────────────────────────────────────────
	//
	// Intercept every agent-initiated bash tool call and export PI_SUBAGENT=1
	// inside that shell. This ensures any descendant process spawned by that bash
	// command — including wrapper scripts or eval harnesses that later spawn `pi`
	// — inherits subagent mode and therefore uses `X-Initiator: agent` for
	// GitHub Copilot requests.

	pi.on("tool_call", async (event, _ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		const cmd: string = event.input.command ?? "";
		event.input.command = withSubagentEnv(cmd);
	});
}
