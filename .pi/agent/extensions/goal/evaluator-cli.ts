import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveModelReference } from "../shared/model-reference.js";
import {
  PI_GUARDRAILS_DISABLED,
  PI_GUARDRAILS_PREFLIGHT_DISABLED,
} from "../shared/guardrails-session-state.ts";
import { isGondolinSandboxRequested } from "../shared/sandbox-intent.ts";

export const PI_SANDBOX = "PI_SANDBOX";
export const PI_SANDBOX_SESSION_POLICY = "PI_SANDBOX_SESSION_POLICY_V1";

// The evaluator is invoked with a prompt argument, never stdin. Keeping a stdin
// pipe open prevents Pi's non-interactive process from exiting.
export const EVALUATOR_STDIO: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];

export type EvaluatorLaunchSettings = {
  guardrailsDisabled: boolean;
  preflightGuardrailsDisabled: boolean;
  sandboxRequested: boolean;
  /** Load only the security extensions, while keeping unrelated extensions disabled. */
  loadSecurityExtensions?: boolean;
};

export function getEvaluatorLaunchSettings(
  argv: readonly string[] = process.argv,
  env: Readonly<Record<string, string | undefined>> = process.env,
): EvaluatorLaunchSettings {
  return {
    guardrailsDisabled:
      hasEnabledBooleanFlag(argv, "no-guardrails") || env[PI_GUARDRAILS_DISABLED] === "1",
    preflightGuardrailsDisabled:
      hasEnabledBooleanFlag(argv, "no-preflight-guardrails") || env[PI_GUARDRAILS_PREFLIGHT_DISABLED] === "1",
    sandboxRequested: isGondolinSandboxRequested(argv, env),
    loadSecurityExtensions: true,
  };
}

/** Build the evaluator child environment without losing active security state. */
export function buildEvaluatorEnv(
  settings: Pick<EvaluatorLaunchSettings, "sandboxRequested"> = getEvaluatorLaunchSettings(),
  inheritedEnv: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...inheritedEnv, PI_SUBAGENT: "1" };
  // Guardrail toggles are explicit CLI flags in the child. Do not let the
  // process-local markers override that child configuration.
  delete env[PI_GUARDRAILS_DISABLED];
  delete env[PI_GUARDRAILS_PREFLIGHT_DISABLED];
  if (settings.sandboxRequested) {
    env[PI_SANDBOX] = "gondolin";
  } else {
    delete env[PI_SANDBOX];
    delete env[PI_SANDBOX_SESSION_POLICY];
  }
  return env;
}

export function buildEvaluatorArgs(
  evaluatorModel: string,
  prompt: string,
  settings?: Partial<EvaluatorLaunchSettings>,
): string[] {
  const effective = settings
    ? { ...getEvaluatorLaunchSettings(), ...settings }
    : undefined;
  const securityExtensions = effective?.loadSecurityExtensions
    ? [extensionPath("guardrails"), ...(effective.sandboxRequested ? [extensionPath("gondolin-sandbox")] : [])]
        .filter((path): path is string => path !== undefined)
        .flatMap((path) => ["--extension", path])
    : [];

  return [
    "-p",
    prompt,
    "--model",
    resolveModelReference(evaluatorModel),
    "--no-session",
    // Keep the evaluator isolated from unrelated user extensions, but load the
    // two extensions that own the parent's security boundary.
    "--no-extensions",
    ...securityExtensions,
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    ...(effective?.guardrailsDisabled ? ["--no-guardrails"] : []),
    ...(effective?.preflightGuardrailsDisabled ? ["--no-preflight-guardrails"] : []),
    ...(effective?.sandboxRequested ? ["--sandbox"] : []),
    "--thinking",
    "off",
    "--tools",
    "read,grep,find,ls",
  ];
}

function extensionPath(name: string): string | undefined {
  for (const extension of [join(import.meta.dirname, "..", name, "index.ts"), join(import.meta.dirname, "..", name, "index.js")]) {
    if (existsSync(extension)) return extension;
  }
  return undefined;
}

function hasEnabledBooleanFlag(argv: readonly string[], name: string): boolean {
  const exact = `--${name}`;
  const assignment = `${exact}=`;
  for (const argument of argv) {
    if (argument === "--") return false;
    if (argument === exact || argument === `${exact}=true`) return true;
    if (argument.startsWith(assignment)) return false;
  }
  return false;
}
