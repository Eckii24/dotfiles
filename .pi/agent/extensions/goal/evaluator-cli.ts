import { resolveModelReference } from "../shared/model-reference.js";

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
