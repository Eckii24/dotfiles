import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { loadExtensions } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";
import { createGondolinSandboxExtension } from "../../index.ts";

type Handler = (event: any, ctx: any) => any;

function harness(options: {
  flag?: boolean; env?: NodeJS.ProcessEnv; image?: string; vm?: any; sourcePath?: string;
  ensureDefaultImage?: (image: string) => Promise<string>;
} = {}) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, Handler>();
  const flags: string[] = [];
  const notices: string[] = [];
  const statuses: string[] = [];
  let imageEnsures = 0;
  let getFlagCalls = 0;
  let shutdowns = 0;
  const vm = options.vm ?? {
    id: "vm-12345678",
    start: async () => {}, close: async () => {},
    exec: async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", stdoutBuffer: Buffer.alloc(0) }),
  };
  const extension = createGondolinSandboxExtension({
    cwd: "/host/repo", env: options.env ?? {}, image: options.image, createVm: async () => vm,
    ensureDefaultImage: options.ensureDefaultImage ?? (async () => { imageEnsures++; return "/images/pi-agent-base"; }),
  });
  const api = {
    registerFlag(name: string) { flags.push(name); },
    getFlag() { getFlagCalls++; return options.flag; },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand() {},
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    getAllTools() {
      return [...tools.values()].map((tool) => ({ ...tool, sourceInfo: { path: options.sourcePath ?? path.resolve(import.meta.dirname, "../..", "index.ts") } }));
    },
  };
  const ctx = (mode = "tui") => ({
  mode, cwd: "/host/repo", hasUI: true, isIdle: () => true, isProjectTrusted: () => false, shutdown() { shutdowns++; },
    ui: {
      setStatus(_key: string, value: string) { statuses.push(value); },
      notify(message: string) { notices.push(message); },
    },
  });
  extension(api as never);
  return {
    api, tools, handlers, flags, vm, ctx, notices, statuses,
    get imageEnsures() { return imageEnsures; },
    get getFlagCalls() { return getFlagCalls; }, get shutdowns() { return shutdowns; },
  };
}

test("factory registers dormant wrappers before CLI values exist", () => {
  const pi = harness({ flag: false });
  assert.equal(pi.getFlagCalls, 0);
  assert.deepEqual([...pi.tools.keys()].sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
  assert.deepEqual(pi.flags, ["sandbox"]);
});

test("session_start latches the real --sandbox flag and starts exactly one VM", async () => {
  let starts = 0;
  const pi = harness({ flag: true, vm: { id: "vm-realflag", start: async () => { starts++; }, close: async () => {} } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(pi.getFlagCalls, 1);
  assert.equal(starts, 1);
});

test("running parent propagates the sandbox marker to inherited child environments", async (t) => {
  const before = process.env.PI_SANDBOX;
  t.after(() => {
    if (before === undefined) delete process.env.PI_SANDBOX;
    else process.env.PI_SANDBOX = before;
  });
  delete process.env.PI_SANDBOX;
  const pi = harness({ flag: true });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(process.env.PI_SANDBOX, "gondolin");
  await pi.handlers.get("session_shutdown")!({}, pi.ctx());
  assert.equal(process.env.PI_SANDBOX, undefined);
});

test("default image is provisioned before VM startup", async () => {
  const pi = harness({ flag: true });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(pi.imageEnsures, 1);
  assert.ok(pi.statuses.includes("SANDBOX building bundled image (first run)"));
});

test("custom image skips bundled image provisioning", async () => {
  const pi = harness({ flag: true, image: "custom:latest" });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(pi.imageEnsures, 0);
});

test("image setup failure reports its exact reason", async () => {
  const pi = harness({
    flag: true,
    ensureDefaultImage: async () => { throw new Error("docker unavailable"); },
  });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.ok(pi.statuses.some((value) => value.includes("image setup failed: docker unavailable")));
  assert.ok(pi.notices.some((value) => value.includes("image setup failed: docker unavailable")));
});

test("session shutdown closes a VM whose startup is still pending", async () => {
  let closeCalls = 0;
  let releaseStart!: () => void;
  let notifyStart!: () => void;
  const started = new Promise<void>((resolve) => { releaseStart = resolve; });
  const startEntered = new Promise<void>((resolve) => { notifyStart = resolve; });
  const vm = {
    id: "vm-starting",
    start: async () => { notifyStart(); await started; },
    close: async () => { closeCalls++; releaseStart(); },
  };
  const pi = harness({ flag: true, vm });

  const startup = pi.handlers.get("session_start")!({}, pi.ctx("print"));
  await startEntered;
  await pi.handlers.get("session_shutdown")!({}, pi.ctx("print"));
  await startup;

  assert.equal(closeCalls, 1);
});

test("only exact PI_SANDBOX marker activates", async () => {
  let starts = 0;
  const pi = harness({ env: { PI_SANDBOX: "gondolin" }, vm: { id: "vm-env", start: async () => { starts++; }, close: async () => {} } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(starts, 1);
});

test("active RPC mode fails closed and shuts down before commands", async () => {
  const pi = harness({ flag: true });
  await pi.handlers.get("session_start")!({}, pi.ctx("rpc"));
  assert.equal(pi.shutdowns, 1);
  const result = await pi.tools.get("bash").execute("id", { command: "touch /host/sentinel" });
  assert.match(result.content[0].text, /RPC mode is unsupported/);
  assert.equal(result.isError, true);
});

test("tool collision latches a boundary failure", async () => {
  const pi = harness({ flag: true });
  pi.api.getAllTools = () => [...pi.tools.values()].map((tool: any) => ({
    ...tool, sourceInfo: { path: tool.name === "read" ? "/evil/extension.ts" : "/tmp/pi-gondolin-spike/extension/index.ts" },
  }));
  await pi.handlers.get("session_start")!({}, pi.ctx());
  const result = await pi.tools.get("read").execute("id", { path: "x" });
  assert.match(result.content[0].text, /tool ownership collision.*read/i);
  assert.equal(result.isError, true);
});

test("relative loader ownership paths normalize to the extension entrypoint", async () => {
  const sourcePath = path.relative("/host/repo", path.resolve(import.meta.dirname, "../..", "index.ts"));
  const pi = harness({ flag: true, sourcePath });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  const result = await pi.tools.get("read").execute("id", { path: "x" });
  assert.doesNotMatch(result.content[0].text, /ownership collision/i);
});

test("Pi 0.80.6 loader sourceInfo.path preserves the configured relative path", async () => {
  const extensionDir = path.resolve(import.meta.dirname, "../..");
  const loaded = await loadExtensions(["./index.ts"], extensionDir);
  assert.deepEqual(loaded.errors, []);
  const registered = loaded.extensions[0]?.tools.get("bash");
  assert.equal(registered?.sourceInfo.path, "./index.ts");
});

test("user_bash startup failure returns a complete BashResult without operations or retry", async () => {
  let creates = 0;
  const pi = harness({ flag: true, vm: { id: "broken", start: async () => { creates++; throw new Error("qemu unavailable"); } } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  const first = await pi.handlers.get("user_bash")!({ command: "touch host-sentinel", cwd: "/host/repo" }, pi.ctx());
  const second = await pi.handlers.get("user_bash")!({ command: "touch host-sentinel", cwd: "/host/repo" }, pi.ctx());
  assert.equal(first.operations, undefined);
  assert.deepEqual(first.result, {
    output: "SANDBOX FAILED: qemu unavailable",
    exitCode: 126,
    cancelled: false,
    truncated: false,
  });
  assert.deepEqual(second.result, first.result);
  assert.equal(creates, 1);
});

test("user_bash success executes fully in the guest and returns BashResult without operations", async () => {
  const process: any = Promise.resolve({ exitCode: 7 });
  process.output = async function* () { yield { data: Buffer.from("guest output\n") }; };
  const vm = {
    id: "vm-success", start: async () => {}, close: async () => {},
    exec(args: string[], options: any) {
      assert.deepEqual(args.slice(0, 2), ["/bin/bash", "-lc"]);
    assert.match(args[2], /rewrite/);
    assert.equal(args[4], "/usr/local/bin/rtk");
    assert.equal(args[5], "exit 7");
      assert.equal(options.cwd, "/workspace");
      return process;
    },
  };
  const pi = harness({ flag: true, vm });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  const route = await pi.handlers.get("user_bash")!({ command: "exit 7", cwd: "/host/repo" }, pi.ctx());
  assert.equal(route.operations, undefined);
  assert.deepEqual(route.result, {
    output: "guest output\n",
    exitCode: 7,
    cancelled: false,
    truncated: false,
  });
});