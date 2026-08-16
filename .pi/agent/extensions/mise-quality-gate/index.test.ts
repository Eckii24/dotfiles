import { describe, expect, test } from "bun:test";
import miseQualityGate, { matchesQualityGatePath } from "./index.ts";

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

function createHarness(
  paths: string[],
  verifyResult = { code: 0, stdout: "verified\n", stderr: "" },
  projectTaskSource = "/repo/mise.toml",
  env = dotnetPolicy,
  projectRoot = "/repo",
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
      if (command === "dotnet-in-repo") return { code: 0, stdout: `${projectRoot}\n`, stderr: "" };
      if (command === "mise" && args[0] === "--version") return { code: 0, stdout: "mise 2026.1.0\n", stderr: "" };
      if (command === "mise" && args[0] === "env") return { code: 0, stdout: JSON.stringify(env), stderr: "" };
      if (command === "mise" && args[0] === "tasks") {
        if (args.includes("--json")) return { code: 0, stdout: JSON.stringify({ source: projectTaskSource }), stderr: "" };
        return { code: 0, stdout: args.at(-1) + "\n", stderr: "" };
      }
      if (command === "mise" && args[0] === "run") return verifyResult;
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
  test("shows an enabled status and runs verification for an already-dirty configured path", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(["src/AlreadyDirty.cs"], undefined, "/repo/mise.toml", dotnetPolicy, "/repo/src/v2");
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: enabled — /repo/src/v2"]);
    expect(executions.find(entry => entry.command === "mise" && entry.args[0] === "run")).toMatchObject({
      args: ["run", "--jobs", "1", "verify"],
      options: { cwd: "/repo/src/v2", env: { MISE_TASK_RUN_AUTO_INSTALL: "false" } },
    });
  });

  test("does not run verification when Git reports only Markdown changes", async () => {
    const { ctx, executions, handlers, pi } = createHarness(["README.md", "docs/guide.md"]);
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run")).toHaveLength(0);
  });

  test("shows why the gate is disabled when the include policy is absent", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(["src/Foo.cs"], undefined, "/repo/mise.toml", {});
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: disabled — missing or invalid PI_QUALITY_GATE_INCLUDE"]);
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run")).toHaveLength(0);
  });

  test("requires project-root implementations instead of global fallback tasks", async () => {
    const { ctx, executions, handlers, pi, statuses } = createHarness(
      ["src/Foo.cs"],
      undefined,
      "/home/matthias/.config/mise/config.toml",
    );
    miseQualityGate(pi);

    await handlers.get("session_start")!({}, ctx);
    await handlers.get("agent_end")!({}, ctx);

    expect(statuses).toContainEqual(["mise-quality-gate-availability", "Quality gate: disabled — task format is not defined in this repository"]);
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run")).toHaveLength(0);
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
    expect(executions.filter(entry => entry.command === "mise" && entry.args[0] === "run")).toHaveLength(1);
  });
});
