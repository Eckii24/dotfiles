import { homedir } from "node:os";
import { describe, expect, test } from "bun:test";
import miseQualityGate, { matchesQualityGatePath } from "./index.ts";

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
  const handlers = new Map<string, (event: any, ctx: any) => Promise<unknown> | unknown>();
  const executions: Execution[] = [];
  const notices: string[] = [];
  const statuses: Array<[string, string | undefined]> = [];
  const followUps: string[] = [];
  const gitOutput = paths.join("\0") + (paths.length ? "\0" : "");
  const pi: any = {
    on(name: string, handler: any) { handlers.set(name, handler); },
    sendUserMessage(message: string) { followUps.push(message); },
    async exec(command: string, args: string[], options: any) {
      executions.push({ command, args, options });
      if (command === "git" && args[0] === "rev-parse") return { code: 0, stdout: "/repo\n", stderr: "" };
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
  return { ctx, executions, followUps, handlers, notices, pi, statuses };
}

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
  test("runs inherited verification from the Git repository root", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(["src/AlreadyDirty.py"], undefined, undefined, pythonPolicy, "/repo");
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: enabled — /repo"]);
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
      options: { cwd: "/repo", env: { MISE_TASK_RUN_AUTO_INSTALL: "false" } },
    });
  });

  test("accepts a repository-local quality task override", async () => {
    const { ctx, handlers, pi, statuses } = createHarness(["src/AlreadyDirty.py"], undefined, "/repo/mise.toml", pythonPolicy);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: enabled — /repo"]);
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

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: disabled — global project-root resolver is overridden"]);
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

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: disabled — missing or invalid PI_QUALITY_GATE_INCLUDE"]);
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(0);
  });

  test("does not accept global quality-task fallbacks", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(
      ["src/Foo.cs"],
      undefined,
      globalMiseConfig,
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: disabled — quality task format is unavailable"]);
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(0);
  });

  test("shows active status and queues one redacted repair handoff on verification failure", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const { ctx, executions, followUps, handlers, notices, pi, statuses } = createHarness(
      ["src/GeneratedByPython.cs"],
      { code: 1, stdout: `Tests failed\nraw token ${secret}\nAuthorization: Bearer ${secret}\npassword=hunter2`, stderr: "" },
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate", "Running mise verify…"]);
    expect(statuses).toContainEqual(["mise-quality-gate", undefined]);
    expect(notices.some(message => message.includes("Quality gate failed"))).toBe(true);
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toContain("Tests failed");
    expect(followUps[0]).toContain("[REDACTED]");
    expect(followUps[0]).not.toContain(secret);
    expect(followUps[0]).not.toContain("hunter2");
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run" && entry.args.at(-1) === "verify")).toHaveLength(1);
  });
});
