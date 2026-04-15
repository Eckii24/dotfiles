/**
 * Guardrails Extension — Config Loading, Merging & Validation
 *
 * Loads config from these sources, in precedence order:
 * - ~/.pi/agent/guardrails.json (legacy global)
 * - ~/.pi/agent/settings.json#guardrails (global settings)
 * - <effective cwd>/.pi/guardrails.json (legacy project-local)
 * - <effective cwd>/.pi/settings.json#guardrails (project settings)
 *
 * Settings-based sources override legacy guardrails.json sources within the same
 * scope. Project sources still take precedence over global sources.
 *
 * Validates config shape on load, reports errors, falls back to defaults.
 *
 * To make reload behavior robust, configs are cached by file mtimes. Callers can
 * safely call `loadConfig(cwd)` frequently; files are only re-read when one of
 * the relevant config files changes.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { GuardrailsConfig } from "./types.js";
import { getEffectiveCwd } from "./effective-cwd.js";

export const DEFAULT_CONFIG: GuardrailsConfig = {
  timeout: 300000,
  paths: {},
  bash: {},
};

export interface GuardrailsConfigPaths {
  globalPath: string;
  projectPath: string;
  globalSettingsPath: string;
  projectSettingsPath: string;
}

export interface GuardrailsConfigSourceInfo extends GuardrailsConfigPaths {
  hasGlobal: boolean;
  hasProject: boolean;
  hasGlobalSettings: boolean;
  hasProjectSettings: boolean;
  activeSources: string[];
}

interface CachedConfig {
  globalMtimeMs?: number;
  projectMtimeMs?: number;
  globalSettingsMtimeMs?: number;
  projectSettingsMtimeMs?: number;
  config: GuardrailsConfig;
}

type JsonObject = Record<string, unknown>;
type ConfigSourceKind = "legacy" | "settings";

interface LoadedSource {
  label: string;
  active: boolean;
  config: Partial<GuardrailsConfig>;
}

const configCache = new Map<string, CachedConfig>();

export function getConfigPaths(cwd: string): GuardrailsConfigPaths {
  const effectiveCwd = getEffectiveCwd(cwd);
  return {
    globalPath: join(getAgentDir(), "guardrails.json"),
    projectPath: join(effectiveCwd, ".pi", "guardrails.json"),
    globalSettingsPath: join(getAgentDir(), "settings.json"),
    projectSettingsPath: join(effectiveCwd, ".pi", "settings.json"),
  };
}

function getFileMtimeMs(path: string): number | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function loadJsonObject(path: string): JsonObject | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      console.error(`[guardrails] Warning: ${path} must be a JSON object, ignoring`);
      return undefined;
    }
    return raw as JsonObject;
  } catch (e) {
    console.error(`[guardrails] Warning: Could not parse ${path}: ${e}`);
    return undefined;
  }
}

function loadSource(path: string, kind: ConfigSourceKind): LoadedSource {
  const raw = loadJsonObject(path);
  if (!raw) {
    return {
      label: kind === "settings" ? `${path}#guardrails` : path,
      active: false,
      config: {},
    };
  }

  if (kind === "legacy") {
    return {
      label: path,
      active: true,
      config: raw as Partial<GuardrailsConfig>,
    };
  }

  const candidate = raw.guardrails;
  const label = `${path}#guardrails`;
  if (candidate === undefined) {
    return {
      label,
      active: false,
      config: {},
    };
  }

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    console.error(`[guardrails] Warning: ${label} must be a JSON object, ignoring`);
    return {
      label,
      active: false,
      config: {},
    };
  }

  return {
    label,
    active: true,
    config: candidate as Partial<GuardrailsConfig>,
  };
}

export function getConfigSourceInfo(cwd: string): GuardrailsConfigSourceInfo {
  const { globalPath, projectPath, globalSettingsPath, projectSettingsPath } = getConfigPaths(cwd);
  const globalLegacy = loadSource(globalPath, "legacy");
  const globalSettings = loadSource(globalSettingsPath, "settings");
  const projectLegacy = loadSource(projectPath, "legacy");
  const projectSettings = loadSource(projectSettingsPath, "settings");

  return {
    globalPath,
    projectPath,
    globalSettingsPath,
    projectSettingsPath,
    hasGlobal: globalLegacy.active,
    hasProject: projectLegacy.active,
    hasGlobalSettings: globalSettings.active,
    hasProjectSettings: projectSettings.active,
    activeSources: [globalLegacy, globalSettings, projectLegacy, projectSettings]
      .filter((source) => source.active)
      .map((source) => source.label),
  };
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

export function loadConfig(cwd: string, options: { force?: boolean } = {}): GuardrailsConfig {
  const { globalPath, projectPath, globalSettingsPath, projectSettingsPath } = getConfigPaths(cwd);
  const cacheKey = `${globalPath}::${projectPath}::${globalSettingsPath}::${projectSettingsPath}`;
  const globalMtimeMs = getFileMtimeMs(globalPath);
  const projectMtimeMs = getFileMtimeMs(projectPath);
  const globalSettingsMtimeMs = getFileMtimeMs(globalSettingsPath);
  const projectSettingsMtimeMs = getFileMtimeMs(projectSettingsPath);
  const cached = configCache.get(cacheKey);

  if (
    !options.force &&
    cached &&
    cached.globalMtimeMs === globalMtimeMs &&
    cached.projectMtimeMs === projectMtimeMs &&
    cached.globalSettingsMtimeMs === globalSettingsMtimeMs &&
    cached.projectSettingsMtimeMs === projectSettingsMtimeMs
  ) {
    return cached.config;
  }

  const sources = [
    loadSource(globalPath, "legacy"),
    loadSource(globalSettingsPath, "settings"),
    loadSource(projectPath, "legacy"),
    loadSource(projectSettingsPath, "settings"),
  ];

  const config = sources.reduce((current, source) => {
    if (!source.active) return current;
    const { config: validated } = validateConfig(source.config, source.label);
    return mergeConfigs(current, validated);
  }, DEFAULT_CONFIG);

  configCache.set(cacheKey, {
    globalMtimeMs,
    projectMtimeMs,
    globalSettingsMtimeMs,
    projectSettingsMtimeMs,
    config,
  });
  return config;
}
