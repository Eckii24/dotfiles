/**
 * Process-local state used when Herdr launches a fresh Pi child.
 *
 * Guardrails slash commands mutate in-memory session state. A child is a new
 * process, so the launcher reads only these narrow markers and converts them
 * back into Guardrails CLI flags. They are never inherited by the child.
 */
export const PI_GUARDRAILS_DISABLED = "PI_GUARDRAILS_DISABLED";
export const PI_GUARDRAILS_PREFLIGHT_DISABLED = "PI_GUARDRAILS_PREFLIGHT_DISABLED";

export function syncGuardrailsLaunchState(guardrailsEnabled: boolean, preflightEnabled: boolean): void {
	if (guardrailsEnabled) delete process.env[PI_GUARDRAILS_DISABLED];
	else process.env[PI_GUARDRAILS_DISABLED] = "1";

	if (preflightEnabled) delete process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
	else process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = "1";
}
