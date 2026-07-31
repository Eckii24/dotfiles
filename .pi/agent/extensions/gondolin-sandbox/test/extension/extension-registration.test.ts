import assert from "node:assert/strict";
import * as path from "node:path";
import { realpathSync } from "node:fs";
import test from "node:test";
import { createGondolinSandboxExtension } from "../../index.ts";
import { SANDBOX_SESSION_POLICY_ENV } from "../../policy/startup.ts";

const piEntryUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
const { loadExtensions } = await import(new URL("./core/extensions/loader.js", piEntryUrl).href);

type Handler = (event: any, ctx: any) => any;

function harness(options: {
  flag?: boolean; flagValues?: Record<string, unknown>; env?: NodeJS.ProcessEnv; image?: string; vm?: any; sourcePath?: string; toolNames?: string[];
  ensureDefaultImage?: (image: string) => Promise<string>;
} = {}) {
  const tools = new Map<string, any>();
  const handlers = new Map<string, Handler>();
  const commands = new Map<string, any>();
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
    getFlag(name: string) { getFlagCalls++; return Object.prototype.hasOwnProperty.call(options.flagValues ?? {}, name) ? options.flagValues?.[name] : name === "sandbox" ? options.flag : undefined; },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, descriptor: any) { commands.set(name, descriptor); },
    on(name: string, handler: Handler) { handlers.set(name, handler); },
    getAllTools() {
      return [...tools.values()]
        .filter((tool) => !options.toolNames || options.toolNames.includes(tool.name))
        .map((tool) => ({ ...tool, sourceInfo: { path: options.sourcePath ?? path.resolve(import.meta.dirname, "../..", "index.ts") } }));
    },
  };
  const ctx = (mode = "tui") => ({
  mode, cwd: "/host/repo", hasUI: true, isIdle: () => true, isProjectTrusted: () => false, shutdown() { shutdowns++; },
    ui: {
      setStatus(_key: string, value: string) { statuses.push(value); },
      notify(message: string) { notices.push(message); },
      select: async () => undefined,
      input: async () => undefined,
      confirm: async () => false,
    },
  });
  extension(api as never);
  return {
    api, tools, handlers, commands, flags, vm, ctx, notices, statuses,
    get imageEnsures() { return imageEnsures; },
    get getFlagCalls() { return getFlagCalls; }, get shutdowns() { return shutdowns; },
  };
}

test("factory registers dormant wrappers before CLI values exist", () => {
  const pi = harness({ flag: false });
  assert.equal(pi.getFlagCalls, 0);
  assert.deepEqual([...pi.tools.keys()].sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
  assert.deepEqual(pi.flags, ["sandbox", "sandbox-mount-ro", "sandbox-mount-rw", "sandbox-network-allow", "sandbox-network-deny"]);
});

test("session_start latches the real --sandbox flag and starts exactly one VM", async () => {
  let starts = 0;
  const pi = harness({ flag: true, vm: { id: "vm-realflag", start: async () => { starts++; }, close: async () => {} } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(pi.getFlagCalls, 5);
  assert.equal(starts, 1);
});

test("startup policy flags require explicit --sandbox and fail closed", async () => {
  const pi = harness({ flag: false, flagValues: { "sandbox-network-allow": "api.example.com" } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.ok(pi.statuses.some((value) => value.includes("startup mount/network flags require explicit --sandbox")));
  const result = await pi.tools.get("bash").execute("id", { command: "pwd" });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /require explicit --sandbox/);
});

test("session-only CLI policy is effective now, exported after startup, and restored on shutdown", async (t) => {
  const beforeSandbox = process.env.PI_SANDBOX; const beforePolicy = process.env[SANDBOX_SESSION_POLICY_ENV];
  t.after(() => {
    if (beforeSandbox === undefined) delete process.env.PI_SANDBOX; else process.env.PI_SANDBOX = beforeSandbox;
    if (beforePolicy === undefined) delete process.env[SANDBOX_SESSION_POLICY_ENV]; else process.env[SANDBOX_SESSION_POLICY_ENV] = beforePolicy;
  });
  delete process.env.PI_SANDBOX; delete process.env[SANDBOX_SESSION_POLICY_ENV];
  const pi = harness({ flag: true, flagValues: {
    "sandbox-mount-ro": "/tmp",
    "sandbox-network-allow": JSON.stringify(["api.example.com", "*.example.org"]),
    "sandbox-network-deny": "blocked.example.org",
  } });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(process.env.PI_SANDBOX, "gondolin");
  const canonicalTmp = realpathSync("/tmp");
  assert.deepEqual(JSON.parse(process.env[SANDBOX_SESSION_POLICY_ENV]!), {
    mounts: { readOnly: [{ hostPath: canonicalTmp, guestPath: canonicalTmp, required: false }] },
    network: { allow: ["*.example.org", "api.example.com"], deny: ["blocked.example.org"] },
  });
  await pi.commands.get("sandbox-status").handler("", pi.ctx());
  assert.ok(pi.notices.some((value) => value.includes(`${canonicalTmp} -> ${canonicalTmp} (ro)`) && value.includes('network={"allow":["*.example.org","api.example.com"],"deny":["blocked.example.org"]}')));
  await pi.handlers.get("session_shutdown")!({}, pi.ctx());
  assert.equal(process.env.PI_SANDBOX, undefined); assert.equal(process.env[SANDBOX_SESSION_POLICY_ENV], undefined);
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

test("scout-like tool subset starts without adding absent mutation tools", async () => {
  let starts = 0;
  const pi = harness({
    flag: true,
    toolNames: ["read", "grep", "find", "ls", "bash"],
    vm: { id: "vm-scout", start: async () => { starts++; }, close: async () => {} },
  });
  assert.deepEqual(pi.api.getAllTools().map((tool: any) => tool.name).sort(), ["bash", "find", "grep", "ls", "read"]);
  await pi.handlers.get("session_start")!({}, pi.ctx());
  assert.equal(starts, 1);
  assert.ok(!pi.statuses.some((status) => /ownership collision/i.test(status)));
});

test("sandbox search/list use bounded guest scripts with Pi-compatible paths and semantics", async () => {
  const calls: any[] = [];
  const vm = { id: "vm-search", start: async () => {}, close: async () => {}, exec: async (args: string[], options: any) => {
    calls.push({ args, options });
    return { ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t1\t0\t0\nsrc/a.ts\n", stderr: "" };
  }};
  const pi = harness({ flag: true, vm });
  await pi.handlers.get("session_start")!({}, pi.ctx());
  const grep = await pi.tools.get("grep").execute("id", { pattern: "hit", path: "src", glob: "*.ts" });
  const find = await pi.tools.get("find").execute("id", { pattern: "**/*.ts", path: "src" });
  const listing = await pi.tools.get("ls").execute("id", { path: "src" });
  assert.equal(grep.content[0].text, "src/a.ts");
  assert.equal(find.content[0].text, "src/a.ts");
  assert.equal(listing.content[0].text, "src/a.ts");
  assert.ok(calls[0].args[2].includes("--hidden"));
  assert.ok(calls[0].args[2].includes("--glob"));
  assert.ok(calls[1].args[2].includes("--exclude-standard"));
  assert.ok(calls[2].args[2].includes("sort -z -f"));
  assert.deepEqual(calls.map((call) => call.args[4]), ["/workspace/src", "/workspace/src", "/workspace/src"]);
  assert.ok(calls.every((call) => call.options.signal === undefined));
});

test("guest search scripts preserve errors, path types, subdirectory paths, and safe filename transport", async () => {
  const calls: any[] = [];
  const vm = { id: "vm-search-safety", start: async () => {}, close: async () => {}, exec: async (args: string[]) => {
    calls.push(args);
    if (args[3] === "grep-bounded" && args[5] === "[") {
      return { ok: false, exitCode: 2, stdout: "", stderr: "regex parse error" };
    }
    return { ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t1\t0\t0\nnested/a.ts\n", stderr: "" };
  }};
  const pi = harness({ flag: true, vm });
  await pi.handlers.get("session_start")!({}, pi.ctx());

  const regexFailure = await pi.tools.get("grep").execute("id", { pattern: "[", path: "one-file.ts" });
  assert.equal(regexFailure.isError, true);
  assert.match(regexFailure.content[0].text, /regex parse error/);
  await pi.tools.get("grep").execute("id", { pattern: "hit", path: "one-file.ts" });
  await pi.tools.get("find").execute("id", { pattern: "**/*.ts", path: "subdir" });
  await pi.tools.get("ls").execute("id", { path: "subdir" });

  const [badGrep, grep, find, ls] = calls;
  assert.equal(grep[4], "/workspace/one-file.ts");
  assert.match(grep[2], /\[ -f "\$root" \]/);
  assert.doesNotMatch(grep[2], /2>\/dev\/null/);
  assert.match(grep[2], /newline-bearing path is unsupported/);
  assert.match(find[2], /\[ -d "\$root" \] \|\| fail/);
  assert.match(find[2], /git ls-files -co --exclude-standard -z -- \./);
  assert.match(find[2], /cd "\$root"/);
  assert.match(find[2], /-printf '%P\\0'/);
  assert.match(ls[2], /\[ -d "\$root" \] \|\| fail/);
  assert.match(ls[2], /sort -z -f/);
  assert.match(ls[2], /newline-bearing path is unsupported/);
  assert.equal(badGrep[3], "grep-bounded");
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

test("installed Pi loader sourceInfo.path preserves the configured relative path", async () => {
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