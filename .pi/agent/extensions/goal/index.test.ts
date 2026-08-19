import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildEvaluatorArgs } from "../goal/evaluator-cli.ts";
import goalExtension, {
  parseGoalCommand,
  pauseGoalState,
  resumeGoalState,
} from "../goal/index.ts";

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
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-themes",
      "--thinking",
      "off",
      "--tools",
      "read,grep,find,ls",
    ]);
    expect(args).not.toContain("--thinking-level");
    expect(args).not.toContain("edit");
    expect(args).not.toContain("write");
    expect(args).not.toContain("bash");
  });
});

describe("Goal command parser", () => {
  test("parses only canonical commands", () => {
    expect(parseGoalCommand("")).toEqual({ type: "status", showNavigation: true });
    expect(parseGoalCommand("status")).toEqual({ type: "status", showNavigation: false });
    expect(parseGoalCommand("help")).toEqual({ type: "help" });
    expect(parseGoalCommand("configure")).toEqual({ type: "configure" });
    expect(parseGoalCommand("pause")).toEqual({ type: "pause" });
    expect(parseGoalCommand("resume")).toEqual({ type: "resume" });
    expect(parseGoalCommand("cancel")).toEqual({ type: "cancel" });
    expect(parseGoalCommand("start all tests pass")).toEqual({
      type: "start",
      condition: "all tests pass",
    });
  });

  test("rejects legacy aliases, implicit starts, and malformed commands", () => {
    for (const input of ["clear", "stop", "off", "reset", "none", "hold", "continue", "all tests pass"]) {
      expect(parseGoalCommand(input).type).toBe("invalid");
    }
    expect(parseGoalCommand("start").type).toBe("invalid");
    expect(parseGoalCommand("status extra").type).toBe("invalid");
    expect(parseGoalCommand("pause now").type).toBe("invalid");
  });
});

describe("Goal pause and resume state", () => {
  const active = {
    version: 1 as const,
    goalId: "goal-1",
    condition: "all tests pass",
    maxTurns: 20,
    currentTurn: 7,
    evaluatorModel: "@small",
    status: "active" as const,
    useFreshSession: false,
  };

  test("pause retains the budget and records a user-paused reason", () => {
    expect(pauseGoalState(active)).toEqual({
      ...active,
      status: "paused",
      lastEvalReason: "Paused by user.",
    });
  });

  test("resume resets the budget and retains the goal contract", () => {
    const paused = pauseGoalState(active);

    expect(resumeGoalState(paused)).toEqual({
      ...active,
      status: "active",
      currentTurn: 1,
      lastEvalReason: "Resumed by user.",
    });
  });
});

describe("Goal pause and resume command", () => {
  test("persists pause and queues a reset-budget continuation on resume", async () => {
    const entries: any[] = [{
      type: "custom",
      customType: "goal-state",
      data: {
        version: 1,
        goalId: "goal-1",
        condition: "all tests pass",
        maxTurns: 20,
        currentTurn: 7,
        evaluatorModel: "@small",
        status: "active",
        useFreshSession: false,
      },
    }];
    const commands = new Map<string, any>();
    const sent: string[] = [];
    const notices: string[] = [];
    const pi: any = {
      registerCommand(name: string, command: any) { commands.set(name, command); },
      on() {},
      appendEntry(customType: string, data: unknown) {
        entries.push({ type: "custom", customType, data });
      },
      sendUserMessage(message: string) { sent.push(message); },
      events: { emit() {} },
    };
    const ctx: any = {
      hasUI: true,
      cwd: process.cwd(),
      sessionManager: {
        getBranch() { return entries; },
        getSessionFile() { return "/tmp/goal-session.jsonl"; },
      },
      ui: {
        notify(message: string) { notices.push(message); },
        setStatus() {},
        theme: { fg(_color: string, text: string) { return text; } },
      },
      newSession() { throw new Error("not expected for same-session goal"); },
      waitForIdle() {},
      isIdle() { return true; },
      hasPendingMessages() { return false; },
    };

    goalExtension(pi);
    const command = commands.get("goal");

    await command.handler("pause", ctx);
    expect(entries.at(-1).data).toMatchObject({ status: "paused", currentTurn: 7 });
    expect(notices).toContain("Goal paused");

    await command.handler("resume", ctx);
    expect(entries.at(-1).data).toMatchObject({ status: "active", currentTurn: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Goal resumed by user.");

    const entriesAfterResume = entries.length;
    await command.handler("all tests pass", ctx);
    expect(entries).toHaveLength(entriesAfterResume);
    expect(notices.at(-1)).toContain("Unknown Goal command");

    await command.handler("", ctx);
    expect(notices.at(-1)).toContain("Condition: all tests pass");
    expect(notices.at(-1)).toContain("/goal start <condition>");
  });
});
