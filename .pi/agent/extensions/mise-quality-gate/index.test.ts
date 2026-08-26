import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadQualityGateSettings } from "./config.ts";
import miseQualityGate, { matchesQualityGatePath } from "./index.ts";
import { PI_QUALITY_GATE_ATTEMPTS, PI_QUALITY_GATE_DISABLED, PI_QUALITY_GATE_TASK } from "../shared/quality-gate-session-state.ts";

const initialQualityEnv = {
  disabled: process.env[PI_QUALITY_GATE_DISABLED],
  task: process.env[PI_QUALITY_GATE_TASK],
  attempts: process.env[PI_QUALITY_GATE_ATTEMPTS],
};
function restoreQualityEnv() {
  for (const [key, value] of [
    [PI_QUALITY_GATE_DISABLED, initialQualityEnv.disabled],
    [PI_QUALITY_GATE_TASK, initialQualityEnv.task],
    [PI_QUALITY_GATE_ATTEMPTS, initialQualityEnv.attempts],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
beforeEach(restoreQualityEnv);
afterEach(restoreQualityEnv);

const globalMiseConfig = `${homedir()}/.config/mise/config.toml`;
const reposMiseConfig = "/mise.toml";

type Execution = { command: string; args: string[]; options: any };

const dotnetPolicy = {
  PI_QUALITY_GATE_INCLUDE: JSON.stringify([
    "**/*.cs",
    "**/*.csproj",
    "**/*.props",
    "**/*.targets",
    "**/*.sln",
    "**/*.slnx",
    "**/.editorconfig",
    "Directory.Build.props",
    "Directory.Build.targets",
    "Directory.Packages.props",
    "global.json",
    "NuGet.config",
    "nuget.config",
    "packages.lock.json",
  ]),
  PI_QUALITY_GATE_EXCLUDE: JSON.stringify(["**/bin/**", "**/obj/**"]),
};

const pythonPolicy = {
  PI_QUALITY_GATE_INCLUDE: JSON.stringify(["**/*.py"]),
  PI_QUALITY_GATE_EXCLUDE: JSON.stringify(["**/__pycache__/**"]),
};

function createHarness(
  paths: string[],
  verifyResult = { code: 0, stdout: "verified\n", stderr: "" },
  projectTaskSource = reposMiseConfig,
  env = dotnetPolicy,
  projectRoot = "/repo",
  resolverSource = globalMiseConfig,
) {
  const commands = new Map<string, { handler: (args: string, ctx: any) => Promise<unknown> | unknown }>();
  const flags = new Map<string, unknown>();
  const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>();
  const executions: Execution[] = [];
  const notices: string[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const followUps: string[] = [];
  const gitOutput = paths.join("\0") + (paths.length ? "\0" : "");
  const pi: any = {
    getFlag(name: string) { return flags.get(name); },
    on(name: string, handler: any) { handlers.set(name, handler); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerFlag(name: string, options: any) { if (!flags.has(name)) flags.set(name, options.default); },
    sendUserMessage(message: string) { followUps.push(message); },
    async exec(command: string, args: string[], options: any) {
      executions.push({ command, args, options });
      if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: `${projectRoot}\n`, stderr: "" };
      if (command === "git" && ["diff", "ls-files"].includes(args[0])) return { code: 0, stdout: gitOutput, stderr: "" };
      if (command === "mise" && args[0] === "--version") return { code: 0, stdout: "mise 2026.1.0\n", stderr: "" };
      if (command === "mise" && args[0] === "env") return { code: 0, stdout: JSON.stringify(env), stderr: "" };
      if (command === "mise" && args[0] === "tasks") {
        if (args.includes("--json")) {
          const source = args.at(-1) === "pi:quality-gate:project-root" ? resolverSource : projectTaskSource;
          return { code: 0, stdout: JSON.stringify({ source, dir: projectRoot }), stderr: "" };
        }
        return { code: 0, stdout: args.at(-1) + "\n", stderr: "" };
      }
      if (command === "mise" && args[0] === "run") {
        if (args.at(-1) === "pi:quality-gate:project-root") return { code: 0, stdout: `${projectRoot}\n`, stderr: "" };
        return verifyResult;
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const ctx: any = {
    cwd: "/repo/src",
    hasUI: true,
    signal: undefined,
    ui: {
      notify(message: string) { notices.push(message); },
      setStatus(key: string, text: string | undefined) { statuses.push([key, text]); },
    },
  };
  return { commands, ctx, executions, flags, followUps, handlers, notices, pi, statuses };
}

describe("mise quality-gate settings", () => {
  test("merges global and project settings by field", () => {
    const root = mkdtempSync(join(tmpdir(), "mise-quality-gate-"));
    const agentDirectory = join(root, "agent");
    const repoRoot = join(root, "repo");
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    try {
      mkdirSync(agentDirectory, { recursive: true });
      mkdirSync(join(repoRoot, ".pi"), { recursive: true });
      writeFileSync(join(agentDirectory, "settings.json"), JSON.stringify({ qualityGate: { task: "verify:full", maxRepairAttempts: 2 } }));
      writeFileSync(join(repoRoot, ".pi", "settings.json"), JSON.stringify({ qualityGate: { maxRepairAttempts: 3 } }));
      process.env.PI_CODING_AGENT_DIR = agentDirectory;

      expect(loadQualityGateSettings(repoRoot)).toEqual({ task: "verify:full", maxRepairAttempts: 3 });
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("mise quality-gate policy", () => {
  test("matches configured .NET inputs and excludes generated build outputs", () => {
    const include = JSON.parse(dotnetPolicy.PI_QUALITY_GATE_INCLUDE);
    const exclude = JSON.parse(dotnetPolicy.PI_QUALITY_GATE_EXCLUDE);

    expect(matchesQualityGatePath("src/OrderProcessing/Foo.cs", include, exclude)).toBe(true);
    expect(matchesQualityGatePath("App.slnx", include, exclude)).toBe(true);
    expect(matchesQualityGatePath("src/.editorconfig", include, exclude)).toBe(true);
    expect(matchesQualityGatePath("src/OrderProcessing/bin/Foo.cs", include, exclude)).toBe(false);
    expect(matchesQualityGatePath("README.md", include, exclude)).toBe(false);
  });
});

describe("mise quality gate lifecycle", () => {
  test("registers a CLI switch and skips initialization when quality gate starts disabled", async () => {
    const { commands, ctx, executions, flags, handlers, notices, pi, statuses } = createHarness(["src/Foo.cs"]);
    flags.set("no-quality-gate", true);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toEqual([]);
    expect(notices).toContain("[quality-gate] Quality gate: disabled — disabled for this session");
    await commands.get("quality-gate")!.handler("status", ctx);
    expect(notices.at(-1)).toContain("Reason: disabled for this session");
    expect(executions).toHaveLength(0);
  });

  test("uses configured task and repair attempts", async () => {
    const root = mkdtempSync(join(tmpdir(), "mise-quality-gate-"));
    const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
    try {
      mkdirSync(join(root, ".pi"), { recursive: true });
      writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ qualityGate: { task: "verify:full", maxRepairAttempts: 2 } }));
      process.env.PI_CODING_AGENT_DIR = join(root, "agent-without-settings");
      const { ctx, executions, followUps, handlers, pi } = createHarness(
        ["src/Foo.cs"],
        { code: 1, stdout: "failed", stderr: "" },
        undefined,
        dotnetPolicy,
        root,
      );
      miseQualityGate(pi);

      await handlers.get("session_start")!({}, ctx);
      await handlers.get("agent_end")!({}, ctx);
      await handlers.get("agent_end")!({}, ctx);
      await handlers.get("agent_end")!({}, ctx);

      expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify:full")).toHaveLength(3);
      expect(followUps).toHaveLength(2);
    } finally {
      if (previousAgentDirectory === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("uses any Mise task target from a CLI flag", async () => {
    const { ctx, executions, flags, handlers, pi } = createHarness(["src/Foo.cs"]);
    flags.set("quality-gate-task", "verify:full");
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "tasks" && entry.args.at(-1) === "verify:full")).toBeDefined();
    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify:full")).toMatchObject({
      args: ["run", "--jobs", "1", "verify:full"],
    });
  });

  test("uses repair attempts from a CLI flag", async () => {
    const { ctx, flags, followUps, handlers, pi } = createHarness(
      ["src/Foo.cs"],
      { code: 1, stdout: "failed", stderr: "" },
    );
    flags.set("quality-gate-attempts", "2");
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(followUps).toHaveLength(2);
  });

  test("current enable and reset survive extension reload with stale startup flags", async () => {
    const first = createHarness(["src/Foo.cs"]);
    first.flags.set("no-quality-gate", true);
    first.flags.set("quality-gate-task", "stale:task");
    first.flags.set("quality-gate-attempts", "9");
    miseQualityGate(first.pi);
    await first.commands.get("quality-gate")!.handler("enable", first.ctx);
    await first.commands.get("quality-gate")!.handler("reset", first.ctx);
    expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("0");
    expect(process.env[PI_QUALITY_GATE_TASK]).toBeUndefined();
    expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBeUndefined();

    const reloaded = createHarness(["src/Foo.cs"]);
    reloaded.flags.set("no-quality-gate", true);
    reloaded.flags.set("quality-gate-task", "stale:task");
    reloaded.flags.set("quality-gate-attempts", "9");
    miseQualityGate(reloaded.pi);
    expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("0");
    expect(process.env[PI_QUALITY_GATE_TASK]).toBeUndefined();
    expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBeUndefined();
  });

  test("changes the task target from chat for the current session", async () => {
    const { commands, ctx, executions, handlers, notices, pi, statuses } = createHarness(["src/Foo.cs"]);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await commands.get("quality-gate")!.handler("configure task verify:full", ctx);
    await commands.get("quality-gate")!.handler("configure attempts 2", ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(notices).toContain("Quality gate task set to verify:full");
    expect(notices).toContain("Quality gate automatic repair attempts set to 2");
    expect(process.env[PI_QUALITY_GATE_TASK]).toBe("verify:full");
    expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBe("2");
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify:full")).toHaveLength(1);

    await commands.get("quality-gate")!.handler("disable", ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toEqual([
      ["quality-gate", "Quality gate: running verify:full"],
      ["quality-gate", undefined],
    ]);
    expect(notices).toContain("Quality gate disabled for this session");
    expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("1");
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(0);

    await commands.get("quality-gate")!.handler("reset", ctx);
    await commands.get("quality-gate")!.handler("enable", ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(notices).toContain("Quality gate enabled for this session");
    expect(process.env[PI_QUALITY_GATE_DISABLED]).toBe("0");
    expect(process.env[PI_QUALITY_GATE_TASK]).toBeUndefined();
    expect(process.env[PI_QUALITY_GATE_ATTEMPTS]).toBeUndefined();
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(1);
  });

  test("runs inherited verification from the Pi session directory", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(["src/AlreadyDirty.py"], undefined, undefined, pythonPolicy, "/repo/src");
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "tasks" && entry.args.at(-1) === "pi:quality-gate:project-root")).toMatchObject({
      args: ["tasks", "info", "--json", "pi:quality-gate:project-root"],
      options: { cwd: "/repo/src" },
    });
    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "pi:quality-gate:project-root")).toMatchObject({
      args: ["run", "--quiet", "--output", "interleave", "pi:quality-gate:project-root"],
      options: { cwd: "/repo/src", env: { MISE_TASK_RUN_AUTO_INSTALL: "false" } },
    });
    expect(executions.filter(entry => entry.command === "dotnet-in-repo")).toHaveLength(0);
    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toMatchObject({
      args: ["run", "--jobs", "1", "verify"],
      options: { cwd: "/repo/src", env: { MISE_TASK_RUN_AUTO_INSTALL: "false" } },
    });
  });

  test("accepts a repository-local quality task override", async () => {
    const { ctx, handlers, pi, statuses } = createHarness(["src/AlreadyDirty.py"], undefined, "/repo/mise.toml", pythonPolicy);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

  });

  test("does not execute a project override of the global project-root resolver", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(
      ["src/AlreadyDirty.py"],
      undefined,
      "/repo/mise.toml",
      pythonPolicy,
      "/repo/src/v2",
      "/repo/mise.toml",
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run")).toHaveLength(0);
  });

  test("does not run verification when Git reports only Markdown changes", async () => {
    const { ctx, executions, handlers, pi } = createHarness(["README.md", "docs/guide.md"]);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(0);
  });

  test("shows why the gate is disabled when the include policy is absent", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(["src/Foo.cs"], undefined, "/repo/mise.toml", {});
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(0);
  });

  test("accepts global quality tasks", async () => {
    const { ctx, executions, handlers, pi } = createHarness(
      ["src/Foo.cs"],
      undefined,
      globalMiseConfig,
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(1);
  });

  test("queues one redacted repair handoff on verification failure", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const { ctx, executions, followUps, handlers, notices, pi, statuses } = createHarness(
      ["src/GeneratedByPython.cs"],
      { code: 1, stdout: `Tests failed\nraw token ${secret}\nAuthorization: Bearer ${secret}\npassword=hunter2`, stderr: "" },
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(notices.some(message => message.includes("Quality gate failed"))).toBe(true);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain("Tests failed");
    expect(followUps[0]).toContain("[REDACTED]");
    expect(followUps[0]).not.toContain(secret);
    expect(followUps[0]).not.toContain("hunter2");
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(1);
  });
});
