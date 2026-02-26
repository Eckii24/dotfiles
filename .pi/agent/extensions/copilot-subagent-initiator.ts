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
 *   Intercepts the built-in `bash` tool via the `tool_call` event.  Whenever the
 *   command is about to spawn a `pi` subprocess (detected by a conservative regex),
 *   it patches the command string in-place to export `PI_SUBAGENT=1` into the child's
 *   environment before the original command runs.
 *
 * ── SUBAGENT SIDE  (PI_SUBAGENT=1) ───────────────────────────────────────────────
 *
 *   On startup (`session_start`) the extension:
 *
 *   1. Registers three custom API-type names (one for each real API type used by the
 *      github-copilot models: `anthropic-messages`, `openai-completions`,
 *      `openai-responses`).  Each custom type is backed by a thin wrapper that calls
 *      the real provider stream function but appends `X-Initiator: agent` to the
 *      request options headers.  Because options headers are merged *last* inside the
 *      provider, they override the dynamically-inferred value unconditionally.
 *
 *   2. Re-registers all `github-copilot` models, replacing the `api` field of each
 *      model with the corresponding custom API-type name.  All other model metadata
 *      (baseUrl, per-model headers, cost, contextWindow, …) is preserved verbatim.
 *
 *   Using distinct API-type names means the override is scoped to Copilot models only;
 *   no other provider is affected.
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

/**
 * Custom API-type names registered when running as a subagent.
 * These names are unique to this extension so they don't shadow the global
 * api-type registry entries used by other providers.
 */
const SUBAGENT_API_TYPE = {
	anthropic: "github-copilot-subagent/anthropic-messages",
	completions: "github-copilot-subagent/openai-completions",
	responses: "github-copilot-subagent/openai-responses",
} as const;

/** Maps each real Copilot API type to our subagent replacement. */
const API_TYPE_REMAP: Record<string, string> = {
	"anthropic-messages": SUBAGENT_API_TYPE.anthropic,
	"openai-completions": SUBAGENT_API_TYPE.completions,
	"openai-responses": SUBAGENT_API_TYPE.responses,
};

/** Appended to every LLM request made by a subagent. */
const AGENT_INITIATOR_HEADER = { "X-Initiator": "agent" } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return true if the shell command looks like it's spawning a pi subprocess.
 *
 * Conservative heuristic: match `pi` as a standalone command token that appears
 * - at the very beginning of the command string
 * - after a pipe, semicolon, or logical operator  (|, ;, &&, ||)
 * - after `exec`, `command`, or `env` keywords
 *
 * Deliberately errs on the side of false-negatives (miss some cases) to avoid
 * injecting the env var into unrelated commands that happen to contain "pi".
 */
function commandSpawnsPi(cmd: string): boolean {
	return /(?:^|[|&;]\s*|\bexec\s+|\bcommand\s+|\benv(?:\s+\S+=\S+)*\s+)\bpi\b/.test(cmd);
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

function subagentStreamAnthropic(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	return streamSimpleAnthropic(model, context, withAgentInitiator(options));
}

function subagentStreamCompletions(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	return streamSimpleOpenAICompletions(model, context, withAgentInitiator(options));
}

function subagentStreamResponses(model: Model<any>, context: Context, options?: SimpleStreamOptions) {
	return streamSimpleOpenAIResponses(model, context, withAgentInitiator(options));
}

// ─── Extension entry point ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const isSubagent = process.env[SUBAGENT_ENV] === "1";

	// ── SUBAGENT SIDE ──────────────────────────────────────────────────────────
	if (isSubagent) {
		/**
		 * Step 1: Register our three custom API types.
		 *
		 * We pass `models: []` (empty array) so that the model-registration branch
		 * inside registerProvider is skipped.  Only the `streamSimple` registration
		 * path runs, which does not require baseUrl / apiKey / oauth.
		 */
		pi.registerProvider("_copilot-subagent-anthropic", {
			api: SUBAGENT_API_TYPE.anthropic,
			streamSimple: subagentStreamAnthropic,
		} as any /* no models, so the baseUrl/apiKey checks don't apply */);

		pi.registerProvider("_copilot-subagent-completions", {
			api: SUBAGENT_API_TYPE.completions,
			streamSimple: subagentStreamCompletions,
		} as any);

		pi.registerProvider("_copilot-subagent-responses", {
			api: SUBAGENT_API_TYPE.responses,
			streamSimple: subagentStreamResponses,
		} as any);

		/**
		 * Step 2: Re-register all github-copilot models with the remapped `api` field.
		 *
		 * We do this in `session_start` because that's the first point where
		 * ctx.modelRegistry is available and the built-in model list is fully loaded.
		 *
		 * IMPORTANT: We must call `ctx.modelRegistry.registerProvider()` directly here,
		 * NOT `pi.registerProvider()`.  The `pi.registerProvider()` method (ExtensionAPI)
		 * only queues registrations into `runtime.pendingProviderRegistrations`, which is
		 * flushed exactly once during startup in `bindCore()`.  Any call made from an
		 * event handler like `session_start` would be silently ignored.
		 * `ctx.modelRegistry.registerProvider()` writes directly to the live registry.
		 */
		pi.on("session_start", async (_event, ctx) => {
			const allModels: Model<any>[] = ctx.modelRegistry.getAll();
			const copilotModels = allModels.filter((m) => m.provider === "github-copilot");

			if (copilotModels.length === 0) {
				// Copilot is not configured in this environment — nothing to do.
				return;
			}

			// Build replacement model definitions with remapped api types.
			// Every field except `api` is copied verbatim from the original.
			const remappedModels = copilotModels.map((m) => ({
				id: m.id,
				name: m.name,
				// Use our custom subagent API type, or fall back to the original if
				// it's an unexpected type (forwards-compatibility).
				api: (API_TYPE_REMAP[m.api] ?? m.api) as any,
				reasoning: m.reasoning,
				input: m.input as ("text" | "image")[],
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
				// Per-model headers (User-Agent, Editor-Version, …) must be preserved.
				// We pass them here; registerProvider merges provider-level headers with
				// model-level headers, so we pass them at the model level to be safe.
				headers: (m as any).headers,
				compat: (m as any).compat,
			}));

			// Re-register github-copilot with the remapped model list.
			// The real OAuth token lives in auth.json; we pass a placeholder apiKey so
			// the validation check passes.  Auth resolution always prefers auth.json over
			// the custom provider key fallback, so the placeholder is never used.
			// NOTE: call ctx.modelRegistry.registerProvider() directly — NOT pi.registerProvider()
			// which only queues and never flushes from an event handler.
			const copilotBaseUrl = copilotModels[0].baseUrl;
			ctx.modelRegistry.registerProvider("github-copilot", {
				baseUrl: copilotBaseUrl,
				apiKey: "_placeholder_oauth_in_auth_json",
				models: remappedModels,
			});

			const afterModels = ctx.modelRegistry.getAll().filter((m) => m.provider === "github-copilot");
			process.stderr.write(
				`[copilot-subagent-initiator] Remapped ${afterModels.length} github-copilot models → X-Initiator:agent (e.g. ${afterModels[0]?.id} now uses api=${afterModels[0]?.api})\n`,
			);
			ctx.ui.notify("[copilot-subagent-initiator] X-Initiator forced to 'agent' for all LLM calls", "info");
		});

		return; // Done for the subagent side.
	}

	// ── PARENT SIDE ─────────────────────────────────────────────────────────────
	//
	// Intercept `bash` tool calls that spawn a pi subprocess and inject
	// PI_SUBAGENT=1 into the child process environment.

	pi.on("tool_call", async (event, _ctx) => {
		if (!isToolCallEventType("bash", event)) return;

		const cmd: string = event.input.command ?? "";
		if (!commandSpawnsPi(cmd)) return;

		// Prepend an `export` statement so the env var is visible to the spawned
		// pi process and any nested subshells it may create.
		event.input.command = `export ${SUBAGENT_ENV}=1\n${cmd}`;

		// Return undefined — we're modifying the command in-place, not blocking it.
	});
}
