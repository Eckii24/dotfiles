/**
 * Process-local state used when Herdr launches a fresh Pi child.
 *
 * Guardrails slash commands mutate in-memory session state. A child is a new
 * process, so the launcher reads only these narrow markers and converts them
 * back into Guardrails CLI flags. They are never inherited by the child.
 */
export const PI_GUARDRAILS_DISABLED = "PI_GUARDRAILS_DISABLED";
export const PI_GUARDRAILS_PREFLIGHT_DISABLED = "PI_GUARDRAILS_PREFLIGHT_DISABLED";
export const PI_GUARDRAILS_PREFLIGHT_RULES = "PI_GUARDRAILS_PREFLIGHT_RULES";

export function syncGuardrailsLaunchState(guardrailsEnabled: boolean, preflightEnabled: boolean, preflightRules: readonly string[] = []): void {
	// Keep an explicit effective value. A later slash-command enable must override
	// an original --no-* parent argv when another child is launched.
	process.env[PI_GUARDRAILS_DISABLED] = guardrailsEnabled ? "0" : "1";
	process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = preflightEnabled ? "0" : "1";
	if (preflightRules.length > 0) process.env[PI_GUARDRAILS_PREFLIGHT_RULES] = JSON.stringify(preflightRules);
	else delete process.env[PI_GUARDRAILS_PREFLIGHT_RULES];
}
