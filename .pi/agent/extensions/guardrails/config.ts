/**
 * Guardrails Extension — Config Loading, Merging & Validation
 *
 * Loads config from:
 * - ~/.pi/agent/guardrails.json (global)
 * - <cwd>/.pi/guardrails.json (project-local, takes precedence)
 *
 * Validates config shape on load, reports errors, falls back to defaults.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { GuardrailsConfig } from "./types.js";

const DEFAULT_CONFIG: GuardrailsConfig = {
  timeout: 300000,
  paths: {},
  bash: {},
};

function loadJsonFile(path: string): Partial<GuardrailsConfig> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      console.error(`[guardrails] Warning: ${path} must be a JSON object, ignoring`);
      return {};
    }
    return raw;
  } catch (e) {
    console.error(`[guardrails] Warning: Could not parse ${path}: ${e}`);
    return {};
  }
}

// ─── Validation ───

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

interface ValidationError {
  field: string;
  message: string;
}

function validateConfig(raw: Partial<GuardrailsConfig>, source: string): {
  config: Partial<GuardrailsConfig>;
  errors: ValidationError[];
} {
  const errors: ValidationError[] = [];
  const config: Partial<GuardrailsConfig> = {};

  // timeout
  if (raw.timeout !== undefined) {
    if (typeof raw.timeout === "number" && raw.timeout > 0) {
      config.timeout = raw.timeout;
    } else {
      errors.push({ field: "timeout", message: `must be a positive number, got ${typeof raw.timeout}: ${raw.timeout}` });
    }
  }

  // paths
  if (raw.paths !== undefined) {
    if (typeof raw.paths === "object" && raw.paths !== null && !Array.isArray(raw.paths)) {
      config.paths = {};

      if (raw.paths.denyRead !== undefined) {
        if (isStringArray(raw.paths.denyRead)) {
          config.paths.denyRead = raw.paths.denyRead;
        } else {
          errors.push({ field: "paths.denyRead", message: "must be an array of strings" });
        }
      }

      if (raw.paths.allowWrite !== undefined) {
        if (isStringArray(raw.paths.allowWrite)) {
          config.paths.allowWrite = raw.paths.allowWrite;
        } else {
          errors.push({ field: "paths.allowWrite", message: "must be an array of strings" });
        }
      }

      if (raw.paths.denyWrite !== undefined) {
        if (isStringArray(raw.paths.denyWrite)) {
          config.paths.denyWrite = raw.paths.denyWrite;
        } else {
          errors.push({ field: "paths.denyWrite", message: "must be an array of strings" });
        }
      }
    } else {
      errors.push({ field: "paths", message: "must be an object" });
    }
  }

  // bash
  if (raw.bash !== undefined) {
    if (typeof raw.bash === "object" && raw.bash !== null && !Array.isArray(raw.bash)) {
      config.bash = {};

      if (raw.bash.deny !== undefined) {
        if (isStringArray(raw.bash.deny)) {
          config.bash.deny = raw.bash.deny;
        } else {
          errors.push({ field: "bash.deny", message: "must be an array of strings" });
        }
      }
    } else {
      errors.push({ field: "bash", message: "must be an object" });
    }
  }

  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`[guardrails] Validation error in ${source}: ${err.field} — ${err.message}`);
    }
  }

  return { config, errors };
}

// ─── Merging ───

function mergeArrays(base?: string[], override?: string[]): string[] | undefined {
  if (override !== undefined) return override;
  return base;
}

function mergeConfigs(base: GuardrailsConfig, override: Partial<GuardrailsConfig>): GuardrailsConfig {
  const result: GuardrailsConfig = { ...base };

  if (override.timeout !== undefined) result.timeout = override.timeout;

  if (override.paths) {
    result.paths = {
      ...base.paths,
      denyRead: mergeArrays(base.paths?.denyRead, override.paths.denyRead),
      allowWrite: mergeArrays(base.paths?.allowWrite, override.paths.allowWrite),
      denyWrite: mergeArrays(base.paths?.denyWrite, override.paths.denyWrite),
    };
  }

  if (override.bash) {
    result.bash = {
      ...base.bash,
      deny: mergeArrays(base.bash?.deny, override.bash.deny),
    };
  }

  return result;
}

// ─── Public ───

export function loadConfig(cwd: string): GuardrailsConfig {
  const globalPath = join(getAgentDir(), "guardrails.json");
  const projectPath = join(cwd, ".pi", "guardrails.json");

  const globalRaw = loadJsonFile(globalPath);
  const projectRaw = loadJsonFile(projectPath);

  const { config: globalConfig } = validateConfig(globalRaw, globalPath);
  const { config: projectConfig } = validateConfig(projectRaw, projectPath);

  // Merge: default → global → project (project wins)
  return mergeConfigs(mergeConfigs(DEFAULT_CONFIG, globalConfig), projectConfig);
}
