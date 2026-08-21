import { afterEach, expect, test } from "bun:test";
import {
	PI_GUARDRAILS_DISABLED,
	PI_GUARDRAILS_PREFLIGHT_DISABLED,
	syncGuardrailsLaunchState,
} from "./guardrails-session-state.ts";

const initialGuardrails = process.env[PI_GUARDRAILS_DISABLED];
const initialPreflight = process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];

afterEach(() => {
	if (initialGuardrails === undefined) delete process.env[PI_GUARDRAILS_DISABLED];
	else process.env[PI_GUARDRAILS_DISABLED] = initialGuardrails;
	if (initialPreflight === undefined) delete process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
	else process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED] = initialPreflight;
});

test("records disabled slash-command state for a subsequent Herdr child launch", () => {
	syncGuardrailsLaunchState(false, false);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBe("1");
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBe("1");
});

test("clears a marker when its slash-command setting is re-enabled", () => {
	syncGuardrailsLaunchState(false, false);
	syncGuardrailsLaunchState(true, true);
	expect(process.env[PI_GUARDRAILS_DISABLED]).toBeUndefined();
	expect(process.env[PI_GUARDRAILS_PREFLIGHT_DISABLED]).toBeUndefined();
});
