import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEvaluatorArgs } from "../goal/evaluator-cli.ts";

const tempDirs: string[] = [];
const previousAgentDir = process.env.PI_AGENT_DIR;
const previousCodingAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (previousAgentDir === undefined) delete process.env.PI_AGENT_DIR;
  else process.env.PI_AGENT_DIR = previousAgentDir;
  if (previousCodingAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousCodingAgentDir;
});

describe("Goal evaluator CLI arguments", () => {
  test("uses supported non-interactive thinking syntax and resolves tier aliases", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "goal-evaluator-args-"));
    tempDirs.push(agentDir);
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
      defaultProvider: "openai-codex",
      modelTiers: { small: "gpt-5.6-terra" },
    }));
    process.env.PI_AGENT_DIR = agentDir;
    delete process.env.PI_CODING_AGENT_DIR;

    const args = buildEvaluatorArgs("@small", "verify the goal");

    expect(args).toEqual([
      "-p",
      "verify the goal",
      "--model",
      "openai-codex/gpt-5.6-terra",
      "--no-session",
      "--thinking",
      "off",
    ]);
    expect(args).not.toContain("--thinking-level");
  });
});
