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
import { join, resolve } from "node:path";
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
const MAX_PREFLIGHT_RULES = 20;
const MAX_PREFLIGHT_RULE_CHARS = 500;

function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;
  if (configured && configured.trim().length > 0) {
    return resolve(configured);
  }

  const home = process.env.HOME;
  if (home && home.trim().length > 0) {
    return resolve(home, ".pi", "agent");
  }

  return resolve(".pi", "agent");
}

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

function normalizePreflightRules(value: string[]): string[] {
  return value.map((rule) => rule.trim()).filter((rule) => rule.length > 0);
}

function hasUnsafePreflightRuleText(rule: string): boolean {
  return /[\r\n\u2028\u2029\t\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rule) ||
    /\[\/?PREFLIGHT_VERDICT\]|```|\b(?:DECISION|REASON|CONCERNS):/i.test(rule) ||
    /\b(?:ignore|disregard|forget|override)\b.*\b(?:instruction|policy|rule|above|previous|prior)\b/i.test(rule) ||
    /\balways\s+(?:allow|approve)\b/i.test(rule) ||
    /\b(?:return|output|respond)\b.*\b(?:allow|deny|confirm|verdict|decision)\b/i.test(rule);
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

      if (raw.paths.confirmRead !== undefined) {
        if (isStringArray(raw.paths.confirmRead)) {
          config.paths.confirmRead = raw.paths.confirmRead;
        } else {
          errors.push({ field: "paths.confirmRead", message: "must be an array of strings" });
        }
      }

      if (raw.paths.allowWrite !== undefined) {
        if (isStringArray(raw.paths.allowWrite)) {
          config.paths.allowWrite = raw.paths.allowWrite;
        } else {
          errors.push({ field: "paths.allowWrite", message: "must be an array of strings" });
        }
      }

      if (raw.paths.confirmWrite !== undefined) {
        if (isStringArray(raw.paths.confirmWrite)) {
          config.paths.confirmWrite = raw.paths.confirmWrite;
        } else {
          errors.push({ field: "paths.confirmWrite", message: "must be an array of strings" });
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

      if (raw.bash.confirm !== undefined) {
        if (isStringArray(raw.bash.confirm)) {
          config.bash.confirm = raw.bash.confirm;
        } else {
          errors.push({ field: "bash.confirm", message: "must be an array of strings" });
        }
      }

      if (raw.bash.allow !== undefined) {
        if (isStringArray(raw.bash.allow)) {
          config.bash.allow = raw.bash.allow;
        } else {
          errors.push({ field: "bash.allow", message: "must be an array of strings" });
        }
      }

      if (raw.bash.preflightModel !== undefined) {
        if (typeof raw.bash.preflightModel === "string") {
          config.bash.preflightModel = raw.bash.preflightModel;
        } else {
          errors.push({ field: "bash.preflightModel", message: "must be a string" });
        }
      }

      if (raw.bash.preflightRules !== undefined) {
        if (isStringArray(raw.bash.preflightRules)) {
          const rules = normalizePreflightRules(raw.bash.preflightRules);
          if (rules.length > MAX_PREFLIGHT_RULES) {
            errors.push({ field: "bash.preflightRules", message: `must contain at most ${MAX_PREFLIGHT_RULES} non-empty rules` });
          } else if (rules.some((rule) => rule.length > MAX_PREFLIGHT_RULE_CHARS)) {
            errors.push({ field: "bash.preflightRules", message: `each rule must be at most ${MAX_PREFLIGHT_RULE_CHARS} characters` });
          } else if (rules.some(hasUnsafePreflightRuleText)) {
            errors.push({ field: "bash.preflightRules", message: "must contain only single-line plain-text policy statements" });
          } else {
            config.bash.preflightRules = rules;
          }
        } else {
          errors.push({ field: "bash.preflightRules", message: "must be an array of strings" });
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
      confirmRead: mergeArrays(base.paths?.confirmRead, override.paths.confirmRead),
      allowWrite: mergeArrays(base.paths?.allowWrite, override.paths.allowWrite),
      confirmWrite: mergeArrays(base.paths?.confirmWrite, override.paths.confirmWrite),
    };
  }

  if (override.bash) {
    result.bash = {
      ...base.bash,
      confirm: mergeArrays(base.bash?.confirm, override.bash.confirm),
      allow: mergeArrays(base.bash?.allow, override.bash.allow),
      preflightModel: override.bash.preflightModel ?? base.bash?.preflightModel,
      preflightRules: mergeArrays(base.bash?.preflightRules, override.bash.preflightRules),
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
