import { resolveModelReference } from "../shared/model-reference.js";

export function buildEvaluatorArgs(evaluatorModel: string, prompt: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    resolveModelReference(evaluatorModel),
    "--no-session",
    "--thinking",
    "off",
  ];
}
