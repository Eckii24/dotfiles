import { afterEach, expect, test } from "bun:test";
import {
	PI_QUALITY_GATE_ATTEMPTS,
	PI_QUALITY_GATE_DISABLED,
	PI_QUALITY_GATE_TASK,
	syncQualityGateLaunchState,
} from "./quality-gate-session-state.ts";

const initial = Object.fromEntries([
	PI_QUALITY_GATE_DISABLED,
	PI_QUALITY_GATE_TASK,
	PI_QUALITY_GATE_ATTEMPTS,
].map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const [name, value] of Object.entries(initial)) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test("records only effective session quality-gate overrides", () => {
	syncQualityGateLaunchState({ enabled: false, task: "verify:full", maxRepairAttempts: 3 });
	expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("1");
	expect(process.env[PI_QUALITY_GATE_TASK]).toBe("verify:full");
	expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBe("3");

	syncQualityGateLaunchState({ enabled: true });
	expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("0");
	expect(process.env[PI_QUALITY_GATE_TASK]).toBeUndefined();
	expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBeUndefined();
});
