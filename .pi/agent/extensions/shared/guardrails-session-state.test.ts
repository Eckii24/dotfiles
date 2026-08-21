import { afterEach, expect, test } from "bun:test";
import {
	PI_GUARDRAILS_DISABLED,
	PI_GUARDRAILS_PREFLIGHT_DISABLED,
	PI_GUARDRAILS_PREFLIGHT_RULES,
	syncGuardrailsLaunchState,
} from "./guardrails-session-state.ts";

const initialGuardrails = process.env[PI_GUARDRAILS_DISABLED];
const initialPreflight = process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
const initialRules = process.env[PI_GUARDRAILS_PREFLIGHT_RULES];

afterEach(() => {
	if (initialGuardrails === undefined) delete process.env[PI_GUARDRAILS_DISABLED];
	else process.env[PI_GUARDRAILS_DISABLED] = initialGuardrails;
	if (initialPreflight === undefined) delete process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
	else process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = initialPreflight;
	if (initialRules === undefined) delete process.env[PI_GUARDRAILS_PREFLIGHT_RULES];
	else process.env[PI_GUARDRAILS_PREFLIGHT_RULES] = initialRules;
});

test("records disabled slash-command state for a subsequent Herdr child launch", () => {
	syncGuardrailsLaunchState(false, false);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBe("1");
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("1");
});

test("records enabled state explicitly so it can override stale startup flags", () => {
	syncGuardrailsLaunchState(false, false);
	syncGuardrailsLaunchState(true, true);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBe("0");
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("0");
});

test("records bounded session preflight rules for fresh children", () => {
	syncGuardrailsLaunchState(true, true, ["Require tests before mutation"]);
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_RULES]).toBe('["Require tests before mutation"]');
	syncGuardrailsLaunchState(true, true, []);
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_RULES]).toBeUndefined();
});
