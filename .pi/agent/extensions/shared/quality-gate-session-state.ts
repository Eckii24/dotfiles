/** Effective session-only quality-gate overrides materialized for fresh Pi children. */
export const PI_QUALITY_GATE_DISABLED = "PI_QUALITY_GATE_DISABLED";
export const PI_QUALITY_GATE_TASK = "PI_QUALITY_GATE_TASK";
export const PI_QUALITY_GATE_ATTEMPTS = "PI_QUALITY_GATE_ATTEMPTS";

export type QualityGateLaunchState = {
	enabled: boolean;
	task?: string;
	maxRepairAttempts?: number;
};

export function syncQualityGateLaunchState(state: QualityGateLaunchState): void {
	process.env[PI_QUALITY_GATE_DISABLED] = state.enabled ? "0" : "1";
	if (state.task === undefined) delete process.env[PI_QUALITY_GATE_TASK];
	else process.env[PI_QUALITY_GATE_TASK] = state.task;
	if (state.maxRepairAttempts === undefined) delete process.env[PI_QUALITY_GATE_ATTEMPTS];
	else process.env[PI_QUALITY_GATE_ATTEMPTS] = String(state.maxRepairAttempts);
}
