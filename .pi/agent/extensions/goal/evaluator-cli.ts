import { resolveModelReference } from "../shared/model-reference.js";

// The evaluator is invoked with a prompt argument, never stdin. Keeping a stdin
// pipe open prevents Pi's non-interactive process from exiting.
export const EVALUATOR_STDIO: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];

export function buildEvaluatorArgs(evaluatorModel: string, prompt: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    resolveModelReference(evaluatorModel),
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "--thinking",
    "off",
    "--tools",
    "read,grep,find,ls",
  ];
}
