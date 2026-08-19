import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type QualityGateSettings = {
  task?: string;
  maxRepairAttempts?: number;
};

function agentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;
  return configured?.trim() ? resolve(configured) : join(homedir(), ".pi", "agent");
}

function readQualityGateSettings(path: string): QualityGateSettings {
  if (!existsSync(path)) return {};

  try {
    const settings: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return {};
    const qualityGate = (settings as Record<string, unknown>).qualityGate;
    if (typeof qualityGate !== "object" || qualityGate === null || Array.isArray(qualityGate)) return {};

    const raw = qualityGate as Record<string, unknown>;
    const result: QualityGateSettings = {};
    if (typeof raw.task === "string" && raw.task.trim()) result.task = raw.task.trim();
    if (typeof raw.maxRepairAttempts === "number" && Number.isSafeInteger(raw.maxRepairAttempts) && raw.maxRepairAttempts >= 0) {
      result.maxRepairAttempts = raw.maxRepairAttempts;
    }
    return result;
  } catch {
    return {};
  }
}

export function loadQualityGateSettings(repoRoot: string): QualityGateSettings {
  return {
    ...readQualityGateSettings(join(agentDirectory(), "settings.json")),
    ...readQualityGateSettings(join(repoRoot, ".pi", "settings.json")),
  };
}
