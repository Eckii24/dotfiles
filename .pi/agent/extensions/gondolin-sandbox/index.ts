import * as path from "node:path";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createBashToolDefinition,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createReadToolDefinition,
  createWriteTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  truncateTail,
  type EditOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import {
  buildAssets,
  createHttpHooks,
  importImageFromDirectory,
  parseBuildConfig,
  ReadonlyProvider,
  RealFSProvider,
  resolveImageSelector,
  setImageRef,
  VM,
  type VMOptions,
} from "@earendil-works/gondolin";
import { GUEST_WORKSPACE, SandboxRuntime, isSandboxRequested, mapHostPath, type SandboxMount } from "./core.ts";
import { registerPolicyCommands } from "./policy/commands.ts";
import { loadApprovedEffectivePolicy } from "./policy/loader.ts";
import { isNetworkAllowed, type SandboxPolicy } from "./policy/policy.ts";

const DEFAULT_IMAGE = "pi-agent-base:0.12.0";
const DEFAULT_IMAGE_ARCH = process.arch === "arm64" ? "aarch64" : "x86_64";
const DEFAULT_IMAGE_CONFIG = path.join(import.meta.dirname, "images", "pi-agent-base.build.json");
const BACKEND = process.env.GONDOLIN_VMM || "qemu";
const NETWORK_POLICY = "deny-all";
const ROUTED_TOOLS = ["read", "write", "edit", "bash", "grep", "find", "ls"] as const;
export const NETWORK_ALLOWED_HOSTS: string[] = [];
export const SSH_UNSUPPORTED_DIAGNOSTIC = "ssh.enabled is unsupported: no verified fail-closed SSH mediation configuration";

type VmLike = any;
type ToolResult = { content: Array<{ type: "text"; text: string }>; details: any; isError?: boolean };
type IsolatedBashResult = { output: string; exitCode: number | undefined; cancelled: boolean; truncated: boolean };
type ExtensionDeps = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  image?: string;
  createVm?: () => Promise<VmLike>;
  ensureDefaultImage?: (image: string) => Promise<string>;
};

/** Translate already validated/canonicalized policy into the only VM inputs used at runtime. */
export function buildVmOptions(
  policy: SandboxPolicy,
  canonicalWorkspace: string,
  fallbackImage: string,
  backend: "qemu" | "krun",
): VMOptions {
  if (policy.ssh?.enabled) throw new Error(SSH_UNSUPPORTED_DIAGNOSTIC);
  const mounts: NonNullable<VMOptions["vfs"]>["mounts"] = {};
  const workspaceMode = policy.workspace?.mode ?? "rw";
  if (workspaceMode !== "none") {
    const workspace = new RealFSProvider(canonicalWorkspace);
    mounts[GUEST_WORKSPACE] = workspaceMode === "ro" ? new ReadonlyProvider(workspace) : workspace;
  }
  for (const mount of policy.mounts?.readOnly ?? []) {
    mounts[mount.guestPath] = new ReadonlyProvider(new RealFSProvider(mount.hostPath));
  }
  for (const mount of policy.mounts?.readWrite ?? []) {
    mounts[mount.guestPath] = new RealFSProvider(mount.hostPath);
  }
  const allowedHosts = policy.network?.allow ?? NETWORK_ALLOWED_HOSTS;
  const { httpHooks } = createHttpHooks({
    allowedHosts,
    // allowedHosts gates synthetic DNS; this hook retains deny precedence where a
    // deny entry overlaps a wildcard allow entry.
    isRequestAllowed: (request) => isNetworkAllowed(new URL(request.url).hostname, policy),
  });
  return {
    // Gondolin 0.12.x has a broken deferred-start path for this asset backend;
    // VM.create() must perform the guest start before the runtime's idempotent start call.
    autoStart: true,
    sandbox: { imagePath: policy.image ?? fallbackImage, vmm: backend },
    httpHooks,
    // Do not inherit process.env: these literal policy values exist only in guest exec.
    ...(policy.environment === undefined ? {} : { env: { ...policy.environment } }),
    sessionLabel: "pi-sandbox",
    vfs: { mounts },
  };
}

function policyMounts(policy: SandboxPolicy, canonicalWorkspace: string): SandboxMount[] {
  const workspaceMode = policy.workspace?.mode ?? "rw";
  return [
    ...(workspaceMode === "none" ? [] : [{ hostPath: canonicalWorkspace, guestPath: GUEST_WORKSPACE, readOnly: workspaceMode === "ro" }]),
    ...(policy.mounts?.readOnly ?? []).map((mount) => ({ ...mount, readOnly: true })),
    ...(policy.mounts?.readWrite ?? []).map((mount) => ({ ...mount, readOnly: false })),
  ];
}

function text(value: string, details: any = undefined): ToolResult {
  return { content: [{ type: "text", text: value }], details };
}
function failure(reason: string): ToolResult {
  return { ...text(`SANDBOX FAILED: ${reason}`), isError: true };
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function extensionPath(input: string, cwd: string, mounts: readonly SandboxMount[]): string {
  return mapHostPath(path.resolve(cwd, input), mounts);
}

function normalizedSourcePath(input: string, cwd: string): string {
  const filePath = input.startsWith("file:") ? fileURLToPath(input) : input;
  return path.normalize(path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath));
}

export function isOneShotMode(argv: readonly string[] = process.argv): boolean {
  return argv.includes("--print") || argv.includes("-p") || argv.includes("--mode=json")
    || argv.some((value, index) => value === "--mode" && argv[index + 1] === "json");
}

/** Resolve host-native bundled image or build and import it into Gondolin's local store once. */
export async function ensureDefaultSandboxImage(image: string): Promise<string> {
  try {
    const resolved = resolveImageSelector(image, DEFAULT_IMAGE_ARCH);
    if (resolved.arch === DEFAULT_IMAGE_ARCH) return resolved.assetDir;
    // A local ref may fall back to another architecture; build native instead.
  } catch {
    // Missing local image: build the bundled, verified config below.
  }

  const outputDir = await mkdtemp(path.join(tmpdir(), "pi-gondolin-image-"));
  try {
    const config = parseBuildConfig(await readFile(DEFAULT_IMAGE_CONFIG, "utf8"));
    config.arch = DEFAULT_IMAGE_ARCH;
    // RTK 0.43.0 publishes no aarch64 musl release. Build it in native Alpine
    // instead of injecting an incompatible GNU binary into the guest.
    if (DEFAULT_IMAGE_ARCH === "aarch64") {
      config.alpine!.rootfsPackages = [
        ...(config.alpine!.rootfsPackages ?? []), "build-base", "cargo", "rust", "musl-dev",
      ];
      config.postBuild = {
        ...config.postBuild,
        commands: [
          "set -eu; mkdir -p /dev; mknod -m 666 /dev/null c 1 3 2>/dev/null || true; git clone --depth 1 --branch v0.43.0 https://github.com/rtk-ai/rtk.git /tmp/rtk-src; cd /tmp/rtk-src; cargo build --release --locked; install -m 0755 target/release/rtk /usr/local/bin/rtk; /usr/local/bin/rtk --version; rm -rf /tmp/rtk-src",
        ],
      };
    }
    const result = await buildAssets(config, {
      outputDir,
      configDir: path.dirname(DEFAULT_IMAGE_CONFIG),
      verbose: true,
    });
    const imported = importImageFromDirectory(result.outputDir);
    setImageRef(image, imported.buildId, imported.arch);
    return imported.assetDir;
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

/** A byte-backed rolling tail whose retained state never exceeds either cap. */
export class BoundedTailAccumulator {
  private retained = Buffer.alloc(0);
  private readonly maxBytes: number;
  private readonly maxLines: number;
  truncated = false;

  constructor(maxBytes = DEFAULT_MAX_BYTES, maxLines = DEFAULT_MAX_LINES) {
    this.maxBytes = maxBytes;
    this.maxLines = maxLines;
  }

  append(chunk: Uint8Array): void {
    let incoming = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (incoming.length > this.maxBytes) {
      incoming = incoming.subarray(incoming.length - this.maxBytes);
      this.truncated = true;
    }
    let next = Buffer.concat([this.retained, incoming]);
    if (next.length > this.maxBytes) {
      next = next.subarray(next.length - this.maxBytes);
      this.truncated = true;
    }
    let newlines = 0;
    for (const byte of next) if (byte === 10) newlines++;
    const lines = newlines + (next.length > 0 && next[next.length - 1] !== 10 ? 1 : 0);
    if (lines > this.maxLines) {
      let remove = lines - this.maxLines;
      let cut = 0;
      while (remove > 0) {
        const newline = next.indexOf(10, cut);
        if (newline < 0) break;
        cut = newline + 1;
        remove--;
      }
      next = next.subarray(cut);
      this.truncated = true;
    }
    this.retained = next;
  }

  get content(): string { return this.retained.toString("utf8"); }
  get retainedBytes(): number { return this.retained.length; }
  get retainedLines(): number {
    if (this.retained.length === 0) return 0;
    let lines = this.retained[this.retained.length - 1] === 10 ? 0 : 1;
    for (const byte of this.retained) if (byte === 10) lines++;
    return lines;
  }
}

/** Complete guest read path: line and byte selection happen before bytes cross into the host. */
export async function executeGuestRead(
  vm: VmLike,
  guestPath: string,
  params: { offset?: number; limit?: number },
  signal?: AbortSignal,
): Promise<ToolResult> {
  const start = Math.max(1, Math.floor(params.offset ?? 1));
  const requested = Math.max(0, Math.floor(params.limit ?? DEFAULT_MAX_LINES));
  const guestLines = Math.min(requested, DEFAULT_MAX_LINES) + 1;
  const script = [
    `total=$(/usr/bin/wc -l < "$1") || exit $?`,
    `printf '%s\\n' "$total"`,
    `/usr/bin/tail -n +"$2" -- "$1" | /usr/bin/head -n "$3" | /usr/bin/head -c "$4"`,
  ].join("; ");
  const result = await vm.exec([
    "/bin/bash", "-lc", script, "read-bounded", guestPath, String(start), String(guestLines), String(DEFAULT_MAX_BYTES + 1),
  ], { signal });
  if (!result.ok) throw new Error(result.stderr || `read failed (${result.exitCode})`);
  const source = result.stdoutBuffer ? Buffer.from(result.stdoutBuffer).toString("utf8") : String(result.stdout ?? "");
  const metadataEnd = source.indexOf("\n");
  if (metadataEnd < 0) throw new Error("read failed: missing guest metadata");
  const totalLines = Number.parseInt(source.slice(0, metadataEnd), 10);
  if (!Number.isSafeInteger(totalLines)) throw new Error("read failed: invalid guest metadata");
  if (start > totalLines && totalLines > 0) throw new Error(`Offset ${params.offset} is beyond end of file (${totalLines} lines total)`);
  const selected = source.slice(metadataEnd + 1);
  const truncation = truncateHead(selected);
  let output = truncation.firstLineExceedsLimit
    ? `[Line ${start} exceeds 50KB limit. Use bash to inspect it in the guest.]`
    : truncation.content;
  if (truncation.truncated) {
    const next = start + truncation.outputLines;
    output += `\n\n[Showing lines ${start}-${next - 1} of ${totalLines}. Use offset=${next} to continue.]`;
  } else {
    const shown = Math.min(requested, truncation.outputLines);
    const end = start - 1 + shown;
    if (end < totalLines) output += `\n\n[${totalLines - end} more lines in file. Use offset=${end + 1} to continue.]`;
  }
  return text(output, truncation.truncated ? { truncation } : undefined);
}

const GUEST_RTK = "/usr/local/bin/rtk";
const GUEST_RTK_BASH = [
  'rewritten=$("$1" rewrite "$2" 2>/dev/null)',
  "status=$?",
  'if [ "$status" -eq 0 ] || { [ "$status" -eq 3 ] && [ -n "$rewritten" ]; }; then exec /bin/bash -lc "$rewritten"; fi',
  'if [ "$status" -eq 1 ]; then exec /bin/bash -lc "$2"; fi',
  'printf "SANDBOX FAILED: RTK rewrite unavailable (exit %s)\\n" "$status" >&2',
  "exit 126",
].join("; ");

async function runGuestBash(
  vm: VmLike,
  guestCwd: string,
  params: { command: string; timeout?: number },
  signal?: AbortSignal,
  update?: (result: any) => void,
): Promise<IsolatedBashResult> {
  if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout <= 0)) {
    throw new Error("Invalid timeout: must be a finite positive number of seconds");
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = params.timeout ? setTimeout(abort, params.timeout * 1000) : undefined;
  const output = new BoundedTailAccumulator();
  update?.(text(""));
  try {
    const proc = vm.exec(["/bin/bash", "-lc", GUEST_RTK_BASH, "rtk-bash", GUEST_RTK, params.command], {
      cwd: guestCwd, signal: controller.signal, stdout: "pipe", stderr: "pipe",
    });
    try {
      for await (const chunk of proc.output()) {
        output.append(chunk.data);
        update?.(text(output.content, output.truncated ? { truncation: { truncated: true } } : undefined));
      }
      const completed = await proc;
      return { output: output.content, exitCode: completed.exitCode, cancelled: false, truncated: output.truncated };
    } catch (error) {
      if (controller.signal.aborted) {
        return { output: output.content, exitCode: undefined, cancelled: true, truncated: output.truncated };
      }
      throw error;
    }
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Complete guest bash path: bounded in-memory tail only; never persists to host /tmp. */
export async function executeGuestBash(
  vm: VmLike,
  guestCwd: string,
  params: { command: string; timeout?: number },
  signal?: AbortSignal,
  update?: (result: any) => void,
): Promise<ToolResult> {
  const result = await runGuestBash(vm, guestCwd, params, signal, update);
  let rendered = result.output;
  if (result.truncated) rendered = `[Output truncated in memory; showing bounded tail]\n${rendered}`;
  if (result.cancelled) rendered += `${rendered ? "\n" : ""}Command cancelled`;
  else if (result.exitCode !== 0) rendered += `${rendered ? "\n" : ""}Command exited with code ${result.exitCode}`;
  return text(rendered || "(no output)", result.truncated ? { truncation: { truncated: true } } : undefined);
}

function writeOps(vm: VmLike, cwd: string, mounts: readonly SandboxMount[]): WriteOperations {
  return {
    async writeFile(input, content) {
      const guest = extensionPath(input, cwd, mounts);
      const encoded = Buffer.from(content).toString("base64");
      const result = await vm.exec(["/bin/bash", "-lc", `printf %s ${quote(encoded)} | base64 -d > ${quote(guest)}`]);
      if (!result.ok) throw new Error(result.stderr || `write failed (${result.exitCode})`);
    },
    async mkdir(input) {
      const result = await vm.exec(["/bin/mkdir", "-p", extensionPath(input, cwd, mounts)]);
      if (!result.ok) throw new Error(result.stderr || `mkdir failed (${result.exitCode})`);
    },
  };
}
function editOps(vm: VmLike, cwd: string, mounts: readonly SandboxMount[]): EditOperations {
  const write = writeOps(vm, cwd, mounts);
  return {
    async readFile(input) {
      const result = await vm.exec(["/bin/cat", "--", extensionPath(input, cwd, mounts)]);
      if (!result.ok) throw new Error(result.stderr || `read failed (${result.exitCode})`);
      return result.stdoutBuffer ?? Buffer.from(result.stdout);
    },
    writeFile: write.writeFile,
    async access(input) {
      const guest = extensionPath(input, cwd, mounts);
      const result = await vm.exec(["/bin/test", "-r", guest, "-a", "-w", guest]);
      if (!result.ok) throw new Error(`not readable and writable: ${input}`);
    },
  };
}

export function createGondolinSandboxExtension(deps: ExtensionDeps = {}) {
  return function gondolinSandbox(pi: ExtensionAPI): void {
    const cwd = deps.cwd ?? process.cwd();
    const env = deps.env ?? process.env;
    const agentDir = path.join(env.HOME ?? process.env.HOME ?? "/home/matthias", ".pi", "agent");
    const image = deps.image ?? env.GONDOLIN_DEFAULT_IMAGE ?? DEFAULT_IMAGE;
    let vmImage = image;
    const ensureDefaultImage = deps.ensureDefaultImage ?? ensureDefaultSandboxImage;
    let canonicalCwd = cwd;
    let mounts: SandboxMount[] = [{ hostPath: cwd, guestPath: GUEST_WORKSPACE, readOnly: false }];
    const local = {
      read: createReadTool(cwd), write: createWriteTool(cwd), edit: createEditTool(cwd),
      bash: createBashTool(cwd), grep: createGrepTool(cwd), find: createFindTool(cwd), ls: createLsTool(cwd),
    };
    let activation: "unlatched" | "inactive" | "active" | "failed" = "unlatched";
    let failedReason = "sandbox activation has not been latched at session_start";
    let currentVm: VmLike | undefined;
    let lastContext: ExtensionContext | undefined;
    // Pi child tabs inherit process.env but not parent extension CLI flags.
    // Set exact marker only after this VM starts, then restore it on shutdown.
    let inheritedSandboxMarker: string | undefined;
    let setSandboxMarker = false;
    let effectivePolicy: SandboxPolicy = {};
    const readPolicy = async (trusted: boolean): Promise<SandboxPolicy> => {
      const projectPath = trusted ? path.join(cwd, ".pi", "settings.json") : path.join(cwd, ".pi", "settings.json.disabled");
      let projectId = path.resolve(cwd);
      try { projectId = await realpath(cwd); } catch { /* no project policy */ }
      return loadApprovedEffectivePolicy({ globalPath: path.join(agentDir, "settings.json"), projectPath, approvalsPath: path.join(agentDir, "sandbox-approvals.json"), projectId });
    };

    const createVm = deps.createVm ?? (async () => VM.create(
      buildVmOptions(effectivePolicy, canonicalCwd, vmImage, BACKEND as "qemu" | "krun"),
    ));
    const runtime = new SandboxRuntime(createVm);

    const latchFailure = (reason: string, ctx?: ExtensionContext) => {
      if (activation !== "failed") failedReason = reason;
      activation = "failed";
      const message = `SANDBOX gondolin/${BACKEND} FAILED: ${failedReason}`;
      (ctx ?? lastContext)?.ui.setStatus("sandbox", message);
      (ctx ?? lastContext)?.ui.notify(`Sandbox startup failed: ${failedReason}`, "error");
    };
    const ensure = async (ctx?: ExtensionContext): Promise<VmLike | undefined> => {
      if (ctx) lastContext = ctx;
      if (activation !== "active") return undefined;
      try {
        const vm = await runtime.ensureStarted();
        currentVm = vm;
        (ctx ?? lastContext)?.ui.setStatus("sandbox", `SANDBOX gondolin/${BACKEND} running VM=${vm.id.slice(0, 8)}`);
        return vm;
      } catch (error) {
        latchFailure(errorMessage(error), ctx);
        return undefined;
      }
    };
    const guarded = async <T>(ctx: ExtensionContext | undefined, action: (vm: VmLike) => Promise<T>): Promise<any> => {
      if (activation === "inactive") throw new Error("internal dormant delegation error");
      const vm = await ensure(ctx);
      if (!vm) return failure(failedReason);
      try { return await action(vm); }
      catch (error) {
        // A VM/runtime route failure cannot fall through to a host tool.
        return failure(errorMessage(error));
      }
    };

    pi.registerFlag("sandbox", {
      type: "boolean", default: false,
      description: "Run Pi built-in execution surfaces in a Gondolin micro-VM",
    });
    pi.registerCommand("sandbox-status", {
      description: "Show Gondolin sandbox activation and effective policy",
      async handler(_args, ctx) {
        const mountText = mounts.map((m) => `${m.hostPath} -> ${m.guestPath} (${m.readOnly ? "ro" : "rw"})`).join(", ");
        ctx.ui.notify(`SANDBOX ${activation}\nimage=${vmImage}\nfailure=${activation === "failed" ? failedReason : "none"}\nguest-workspace=${GUEST_WORKSPACE}\nmounts=${mountText}\nnetwork=${NETWORK_POLICY}\npolicy=${JSON.stringify(effectivePolicy)}`, "info");
      },
    });
    registerPolicyCommands(pi, {
      pathsForScope: (scope) => ({ settingsPath: scope === "global" ? path.join(agentDir, "settings.json") : path.join(cwd, ".pi", "settings.json"), approvalsPath: path.join(agentDir, "sandbox-approvals.json"), lockPath: scope === "global" ? path.join(agentDir, ".gondolin-policy.lock") : path.join(cwd, ".pi", ".gondolin-policy.lock"), projectId: path.resolve(cwd), globalAgentDir: agentDir, expectedGlobalTarget: path.join(agentDir, "settings.json##default,e.json") }),
      readPolicy: async (ctx) => readPolicy(ctx.isProjectTrusted()),
    });

    // Wrappers are installed before Pi applies extension CLI values. Until session_start
    // latches activation they retain the ordinary built-in host behavior.
    const readDefinition = createReadToolDefinition(cwd);
    pi.registerTool({ ...readDefinition, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.read.execute(id, params, signal, update);
      return guarded(ctx, (vm) => executeGuestRead(vm, extensionPath(params.path, canonicalCwd, mounts), params, signal));
    }});
    const write = local.write;
    pi.registerTool({ ...write, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.write.execute(id, params, signal, update);
      return guarded(ctx, (vm) => createWriteTool(cwd, { operations: writeOps(vm, canonicalCwd, mounts) }).execute(id, params, signal, update));
    }});
    const edit = local.edit;
    pi.registerTool({ ...edit, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.edit.execute(id, params, signal, update);
      return guarded(ctx, (vm) => createEditTool(cwd, { operations: editOps(vm, canonicalCwd, mounts) }).execute(id, params, signal, update));
    }});
    const bashDefinition = createBashToolDefinition(cwd);
    pi.registerTool({ ...bashDefinition, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.bash.execute(id, params, signal, update);
      return guarded(ctx, (vm) => executeGuestBash(vm, GUEST_WORKSPACE, params, signal, update));
    }});
    const grep = local.grep;
    pi.registerTool({ ...grep, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.grep.execute(id, params, signal, update);
      return guarded(ctx, async (vm) => {
        const guest = extensionPath(params.path || ".", canonicalCwd, mounts);
        const args = ["/usr/bin/rg", "--line-number", "--color=never"];
        if (params.ignoreCase) args.push("--ignore-case");
        if (params.literal) args.push("--fixed-strings");
        if (params.context && params.context > 0) args.push("--context", String(params.context));
        if (params.glob) args.push("--glob", params.glob);
        args.push("--", params.pattern, guest);
        const result = await vm.exec(args, { signal });
        if (result.exitCode !== 0 && result.exitCode !== 1) throw new Error(result.stderr || `grep failed (${result.exitCode})`);
        const lines = String(result.stdout).trimEnd().split("\n").filter(Boolean).slice(0, params.limit ?? 100);
        return text(lines.length ? lines.join("\n") : "No matches found");
      });
    }});
    const find = local.find;
    pi.registerTool({ ...find, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.find.execute(id, params, signal, update);
      return guarded(ctx, async (vm) => {
        const result = await vm.exec(["/usr/bin/find", extensionPath(params.path || ".", canonicalCwd, mounts), "-type", "f", "-path", params.pattern], { signal });
        if (!result.ok) throw new Error(result.stderr || `find failed (${result.exitCode})`);
        const lines = String(result.stdout).trimEnd().split("\n").filter(Boolean).slice(0, params.limit ?? 1000);
        return text(lines.length ? lines.join("\n") : "No files found matching pattern");
      });
    }});
    const ls = local.ls;
    pi.registerTool({ ...ls, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.ls.execute(id, params, signal, update);
      return guarded(ctx, async (vm) => {
        const result = await vm.exec(["/bin/ls", "-1A", "--", extensionPath(params.path || ".", canonicalCwd, mounts)], { signal });
        if (!result.ok) throw new Error(result.stderr || `ls failed (${result.exitCode})`);
        return text(String(result.stdout).trimEnd().split("\n").filter(Boolean).slice(0, params.limit ?? 500).join("\n"));
      });
    }});

    pi.on("session_start", async (_event, ctx) => {
      lastContext = ctx;
      if (activation !== "unlatched") return;
      if (!isSandboxRequested(pi.getFlag("sandbox"), env)) {
        activation = "inactive";
        ctx.ui.setStatus("sandbox", "SANDBOX inactive");
        return;
      }
      activation = "active";
      if (ctx.mode === "rpc") {
        latchFailure("RPC mode is unsupported because RPC bash bypasses extension routing", ctx);
        ctx.shutdown();
        return;
      }
      try {
        // Production VM mounts must use canonical host paths. Test/injected VM factories
        // own their mount semantics and may intentionally use synthetic paths.
        if (!deps.createVm) canonicalCwd = await realpath(cwd);
        effectivePolicy = await readPolicy(ctx.isProjectTrusted());
        mounts = policyMounts(effectivePolicy, canonicalCwd);
      } catch (error) {
        latchFailure(`policy rejected: ${errorMessage(error)}`, ctx);
        return;
      }
      const ownership = new Map(pi.getAllTools().map((tool) => [tool.name, normalizedSourcePath(tool.sourceInfo.path, cwd)]));
      const ownPath = normalizedSourcePath(import.meta.filename, cwd);
      const collisions = ROUTED_TOOLS.filter((name) => ownership.get(name) !== ownPath);
      if (collisions.length) {
        latchFailure(`tool ownership collision: ${collisions.join(", ")}`, ctx);
        return;
      }
      try {
        if (!effectivePolicy.image && image === DEFAULT_IMAGE) {
          ctx.ui.setStatus("sandbox", "SANDBOX building bundled image (first run)");
          vmImage = await ensureDefaultImage(image);
        }
      } catch (error) {
        latchFailure(`image setup failed: ${errorMessage(error)}`, ctx);
        return;
      }
      ctx.ui.setStatus("sandbox", `SANDBOX gondolin/${BACKEND} starting`);
      if (await ensure(ctx)) {
        // Subagents are independent Pi processes. They inherit environment, not
        // extension flags, so propagate activation only from a running parent.
        inheritedSandboxMarker = process.env.PI_SANDBOX;
        process.env.PI_SANDBOX = "gondolin";
        setSandboxMarker = true;
      }
    });
    const oneShot = isOneShotMode();
    pi.on("session_shutdown", async () => {
      currentVm = undefined;
      if (setSandboxMarker) {
        if (inheritedSandboxMarker === undefined) delete process.env.PI_SANDBOX;
        else process.env.PI_SANDBOX = inheritedSandboxMarker;
        setSandboxMarker = false;
      }
      if (oneShot) {
        // Pi print mode awaits this handler before it disposes its own session/runtime.
        // Start VM cleanup but do not join it here: Gondolin IPC teardown needs that disposal.
        void runtime.close().catch(() => {});
        return;
      }
      await runtime.close();
    });
    pi.on("user_bash", async (event, ctx) => {
      if (activation === "unlatched" || activation === "inactive") return;
      const failedResult = (reason: string): IsolatedBashResult => ({
        output: `SANDBOX FAILED: ${reason}`, exitCode: 126, cancelled: false, truncated: false,
      });
      try {
        const vm = await ensure(ctx);
        if (!vm) return { result: failedResult(failedReason) };
        const requestedCwd = deps.createVm ? event.cwd : await realpath(event.cwd);
        const guestCwd = extensionPath(requestedCwd, canonicalCwd, mounts);
        return { result: await runGuestBash(vm, guestCwd, { command: event.command }) };
      } catch (error) {
        latchFailure(errorMessage(error), ctx);
        return { result: failedResult(failedReason) };
      }
    });
  };
}

export default createGondolinSandboxExtension();
