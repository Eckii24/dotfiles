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
  SettingsManager,
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
import { isNetworkAllowed, mergePolicies, type SandboxPolicy } from "./policy/policy.ts";
import { reportStartupStatus } from "../shared/startup-status.ts";
import {
  SANDBOX_SESSION_POLICY_ENV,
  STARTUP_POLICY_FLAGS,
  hasStartupPolicyFlags,
  parseSandboxSettings,
  parseSerializedSessionPolicy,
  parseStartupPolicyFlags,
  serializeSessionPolicy,
} from "./policy/startup.ts";

const DEFAULT_IMAGE = "pi-agent-work:0.12.1";
const DEFAULT_IMAGE_ARCH = process.arch === "arm64" ? "aarch64" : "x86_64";
const DEFAULT_IMAGE_CONFIG = path.join(import.meta.dirname, "images", "pi-agent-work.build.json");
const SEARCH_MAX_BYTES = DEFAULT_MAX_BYTES;
const SEARCH_META = "__GONDOLIN_SEARCH_META__";
const VALID_BACKENDS = new Set(["qemu", "krun"]);
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
  sandboxSettings?: unknown;
};

/** Policy wins over explicit injection; invalid injection fails before VM creation. */
export function resolveBackend(policy: SandboxPolicy, env: NodeJS.ProcessEnv = process.env): "qemu" | "krun" {
  const backend = policy.backend ?? env.GONDOLIN_VMM ?? "qemu";
  if (!VALID_BACKENDS.has(backend)) throw new Error(`backend must be qemu or krun (received ${backend})`);
  return backend as "qemu" | "krun";
}

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
  // Pi reads text via split("\n"): empty files and a final newline each retain
  // one empty line. Emit selected records without an artificial final newline.
  const script = [
    `max=$4; err=$(mktemp) || exit 1; exec 3>&2 2>"$err"; finish() { status=$?; [ "$status" -eq 0 ] || /usr/bin/head -c "$max" "$err" >&3; rm -f "$err"; trap - EXIT; exit "$status"; }; trap finish EXIT`,
    `[ -f "$1" ] && [ -r "$1" ] || { printf 'read failed: cannot read: %s\\n' "$1" >&2; exit 2; }; total=$(( $(/usr/bin/wc -l < "$1") + 1 )) || exit $?`,
    `printf '%s\\n' "$total"`,
    `/usr/bin/awk -v start="$2" -v count="$3" -v total="$total" 'BEGIN { ORS=""; emitted=0 } NR >= start && emitted < count { if (emitted) printf "\\n"; printf "%s", $0; emitted++ } END { virtual=NR+1; if (total == virtual && start <= virtual && start + emitted <= virtual && emitted < count) { if (emitted) printf "\\n"; emitted++ } }' "$1" | /usr/bin/head -c "$((max - 128))"`,

  ].join("; ");
  const result = await vm.exec([
    "/bin/bash", "-lc", script, "read-bounded", guestPath, String(start), String(Math.min(requested, DEFAULT_MAX_LINES)), String(DEFAULT_MAX_BYTES),
  ], { signal });
  if (!result.ok) throw new Error(result.stderr || `read failed (${result.exitCode})`);
  const source = result.stdoutBuffer ? Buffer.from(result.stdoutBuffer).toString("utf8") : String(result.stdout ?? "");
  const metadataEnd = source.indexOf("\n");
  if (metadataEnd < 0) throw new Error("read failed: missing guest metadata");
  const totalLines = Number.parseInt(source.slice(0, metadataEnd), 10);
  if (!Number.isSafeInteger(totalLines)) throw new Error("read failed: invalid guest metadata");
  if (start > totalLines) throw new Error(`Offset ${params.offset} is beyond end of file (${totalLines} lines total)`);
  const selected = source.slice(metadataEnd + 1);
  const truncation = truncateHead(selected);
  let output = truncation.firstLineExceedsLimit
    ? `[Line ${start} exceeds 50KB limit. Use bash to inspect it in the guest.]`
    : truncation.content;
  if (truncation.truncated) {
    const next = start + truncation.outputLines;
    output += `\n\n[Showing lines ${start}-${next - 1} of ${totalLines}. Use offset=${next} to continue.]`;
  } else if (requested !== undefined) {
    const shown = Math.min(requested, totalLines - start + 1);
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
  if (signal?.aborted) {
    return { output: "", exitCode: undefined, cancelled: true, truncated: false };
  }
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

type BoundedSearchMeta = { shown: number; resultLimited: boolean; byteLimited: boolean };

function renderGuestSearch(stdout: unknown, empty: string, noun: string, limit: number): ToolResult {
  const source = String(stdout ?? "");
  const newline = source.indexOf("\n");
  if (newline < 0 || !source.startsWith(SEARCH_META)) throw new Error("search failed: missing guest metadata");
  const [, shownText, resultText, byteText] = source.slice(0, newline).split("\t");
  const meta: BoundedSearchMeta = {
    shown: Number.parseInt(shownText, 10), resultLimited: resultText === "1", byteLimited: byteText === "1",
  };
  if (!Number.isSafeInteger(meta.shown)) throw new Error("search failed: invalid guest metadata");
  // Guest appends exactly one record-separator newline; strip only that one so
  // legitimate trailing/interior spaces on matched lines survive.
  let output = source.slice(newline + 1);
  if (output.endsWith("\n")) output = output.slice(0, -1);
  const notices: string[] = [];
  if (meta.resultLimited) notices.push(`${limit} ${noun} limit reached. Use limit=${limit * 2} for more`);
  if (meta.byteLimited) notices.push(`${SEARCH_MAX_BYTES / 1024}KB limit reached. Refine search`);
  if (!output && !notices.length) return text(empty);
  if (notices.length) output += `${output ? "\n\n" : ""}[${notices.join(". ")}]`;
  return text(output, notices.length ? { matchLimitReached: meta.resultLimited ? limit : undefined, resultLimitReached: meta.resultLimited ? limit : undefined, truncation: meta.byteLimited ? { truncated: true, maxBytes: SEARCH_MAX_BYTES } : undefined } : undefined);
}

/** Guest emits at most limit records and SEARCH_MAX_BYTES before stdout crosses VM boundary. */
export async function executeGuestSearch(
  vm: VmLike, args: string[], signal: AbortSignal | undefined, empty: string, noun: string, limit: number,
): Promise<ToolResult> {
  const result = await vm.exec(args, { signal });
  const stdout = result.stdoutBuffer ? Buffer.from(result.stdoutBuffer).toString("utf8") : String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (Buffer.byteLength(stdout) > SEARCH_MAX_BYTES || Buffer.byteLength(stderr) > SEARCH_MAX_BYTES) {
    throw new Error("search failed: guest output exceeded limit");
  }
  if (!result.ok) throw new Error(stderr || `search failed (${result.exitCode})`);
  return renderGuestSearch(stdout, empty, noun, limit);
}

export const GUEST_GREP = `
root=$1 pattern=$2 limit=$3 stderr_max=$4 ignore=$5 literal=$6 context=$7 glob=$8
err=$(mktemp) || exit 1; out=$(mktemp) || exit 1; exec 3>&2 2>"$err"
finish() { status=$?; [ "$status" -eq 0 ] || /usr/bin/head -c "$stderr_max" "$err" >&3; rm -f "$err" "$out"; trap - EXIT; exit "$status"; }; trap finish EXIT
max=$((stderr_max - 256)); line_cap=${DEFAULT_MAX_LINES}; shown=0; matches=0; bytes=0; limited=0; byte_limited=0; lines_truncated=0
fail() { printf '%s\\n' "$1" >&2; exit 2; }
emit() { line=$1; size=$(printf '%s\\n' "$line" | wc -c); if [ $((bytes + size)) -gt "$max" ]; then byte_limited=1; return 1; fi; printf '%s\\n' "$line" >> "$out"; bytes=$((bytes + size)); }
short() { line=$1; if [ "\${#line}" -gt 500 ]; then lines_truncated=1; printf '%s...' "\${line:0:500}"; else printf '%s' "$line"; fi; }
if [ -f "$root" ]; then cd "$(dirname "$root")" || fail "grep failed: invalid path: $root"; target=$(basename "$root");
elif [ -d "$root" ]; then cd "$root" || fail "grep failed: invalid path: $root"; target=.
else fail "grep failed: invalid path: $root"; fi
while IFS= read -r -d '' name; do [[ "$name" == *$'\\n'* ]] && fail "grep failed: newline-bearing path is unsupported"; done < <(/usr/bin/find "$target" -print0)
args=(/usr/bin/rg --null --with-filename --line-number --no-heading --color=never --hidden)
[ "$ignore" = 1 ] && args+=(--ignore-case); [ "$literal" = 1 ] && args+=(--fixed-strings); [ -n "$glob" ] && args+=(--glob "$glob")
"\${args[@]}" --files-with-matches -- "$pattern" "$target" >/dev/null; status=$?; [ "$status" -eq 0 ] || [ "$status" -eq 1 ] || exit "$status"
while IFS= read -r -d '' file && IFS= read -r record; do
  [[ "$file" == *$'\\n'* ]] && fail "grep failed: newline-bearing path is unsupported"
  [[ "$record" =~ ^([0-9]+):(.*)$ ]] || fail "grep failed: malformed result record"
  line_no=\${BASH_REMATCH[1]}
  matches=$((matches + 1)); if [ "$matches" -gt "$limit" ] || [ "$matches" -gt "$line_cap" ]; then limited=1; break; fi
  start=$((line_no - context)); [ "$start" -lt 1 ] && start=1; end=$((line_no + context)); first=1
  while IFS= read -r source_line || [ -n "$source_line" ]; do
    current=$((start + first - 1)); prefix="\${file#./}:$current:"; [ "$current" -eq "$line_no" ] || prefix="\${file#./}-$current-"
    emit "$prefix$(short "$source_line")" || break 2; first=$((first + 1))
  done < <(/usr/bin/sed -n "\${start},\${end}p" -- "$file")
  shown=$matches
done < <("\${args[@]}" -- "$pattern" "$target")
printf '${SEARCH_META}\\t%s\\t%s\\t%s\\n' "$shown" "$limited" "$byte_limited"; cat "$out"
`;

export const GUEST_FIND = `
root=$1 pattern=$2 limit=$3 stderr_max=$4
err=$(mktemp) || exit 1; out=$(mktemp) || exit 1; exec 3>&2 2>"$err"
finish() { status=$?; [ "$status" -eq 0 ] || /usr/bin/head -c "$stderr_max" "$err" >&3; rm -f "$err" "$out"; trap - EXIT; exit "$status"; }; trap finish EXIT
max=$((stderr_max - 256)); line_cap=${DEFAULT_MAX_LINES}; shown=0; bytes=0; limited=0; byte_limited=0
fail() { printf '%s\\n' "$1" >&2; exit 2; }
emit() { line=$1; size=$(printf '%s\\n' "$line" | wc -c); if [ $shown -ge "$limit" ] || [ $shown -ge "$line_cap" ]; then limited=1; return 1; fi; if [ $((bytes + size)) -gt "$max" ]; then byte_limited=1; return 1; fi; printf '%s\\n' "$line" >> "$out"; shown=$((shown + 1)); bytes=$((bytes + size)); }
glob_match() { local value=$1 glob=$2 segment rest; if [[ "$glob" == \*\*/* ]]; then rest=\${glob#**/}; glob_match "$value" "$rest" && return; [[ "$value" == */* ]] && glob_match "\${value#*/}" "$glob" && return; return 1; fi; if [[ "$glob" != */* ]]; then [[ "\${value##*/}" == $glob ]]; return; fi; segment=\${glob%%/*}; rest=\${glob#*/}; [[ "$value" == */* ]] || return 1; [[ "\${value%%/*}" == $segment ]] && glob_match "\${value#*/}" "$rest"; }
[ -d "$root" ] || fail "find failed: not a directory: $root"
if git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  (cd "$root" && git ls-files -co --exclude-standard -z -- .) >/dev/null || fail "find failed while listing git files"
  candidates() { cd "$root" && git ls-files -co --exclude-standard -z -- .; }
else
  (cd "$root" && /usr/bin/find . -type f -printf '%P\\0') >/dev/null || fail "find failed while listing files"
  candidates() { cd "$root" && /usr/bin/find . -type f -printf '%P\\0'; }
fi
while IFS= read -r -d '' line; do
  [[ "$line" == *$'\\n'* ]] && fail "find failed: newline-bearing path is unsupported"
  if glob_match "$line" "$pattern"; then emit "$line" || break; fi
done < <(candidates)
printf '${SEARCH_META}\\t%s\\t%s\\t%s\\n' "$shown" "$limited" "$byte_limited"; cat "$out"
`;

const GUEST_LS = `
root=$1 limit=$2 stderr_max=$3
err=$(mktemp) || exit 1; out=$(mktemp) || exit 1; exec 3>&2 2>"$err"
finish() { status=$?; [ "$status" -eq 0 ] || /usr/bin/head -c "$stderr_max" "$err" >&3; rm -f "$err" "$out"; trap - EXIT; exit "$status"; }; trap finish EXIT
max=$((stderr_max - 256)); line_cap=${DEFAULT_MAX_LINES}; shown=0; bytes=0; limited=0; byte_limited=0
fail() { printf '%s\\n' "$1" >&2; exit 2; }
emit() { line=$1; size=$(printf '%s\\n' "$line" | wc -c); if [ $shown -ge "$limit" ] || [ $shown -ge "$line_cap" ]; then limited=1; return 1; fi; if [ $((bytes + size)) -gt "$max" ]; then byte_limited=1; return 1; fi; printf '%s\\n' "$line" >> "$out"; shown=$((shown + 1)); bytes=$((bytes + size)); }
[ -d "$root" ] || fail "ls failed: not a directory: $root"
set -o pipefail
(cd "$root" && /usr/bin/find . -mindepth 1 -maxdepth 1 -printf '%f\\0' | LC_ALL=C sort -z -f) > /dev/null || fail "ls failed while listing directory"
while IFS= read -r -d '' name; do [[ "$name" == *$'\\n'* ]] && fail "ls failed: newline-bearing path is unsupported"; [ -d "$root/$name" ] && name="$name/"; emit "$name" || break; done < <(cd "$root" && /usr/bin/find . -mindepth 1 -maxdepth 1 -printf '%f\\0' | LC_ALL=C sort -z -f)
printf '${SEARCH_META}\\t%s\\t%s\\t%s\\n' "$shown" "$limited" "$byte_limited"; cat "$out"
`;

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
    let inheritedSessionPolicy: string | undefined;
    let setSessionPolicy = false;
    let sessionPolicyText: string | undefined;
    let effectivePolicy: SandboxPolicy = {};
    let backend: "qemu" | "krun" = "qemu";
    const createVm = deps.createVm ?? (async () => VM.create(
      buildVmOptions(effectivePolicy, canonicalCwd, vmImage, backend),
    ));
    const runtime = new SandboxRuntime(createVm);

    const setSandboxStatus = (ctx: ExtensionContext | undefined, value: string | undefined): void => {
      if (ctx?.hasUI) ctx.ui.setStatus("gondolin-sandbox", value);
    };
    const isFailed = (): boolean => activation === "failed";
    const latchFailure = (reason: string, ctx?: ExtensionContext) => {
      if (!isFailed()) failedReason = reason;
      activation = "failed";
      const failureContext = ctx ?? lastContext;
      setSandboxStatus(failureContext, `Sandbox disabled: ${failedReason}`);
      failureContext?.ui.notify(`Sandbox startup failed: ${failedReason}`, "error");
    };
    const ensure = async (ctx?: ExtensionContext): Promise<VmLike | undefined> => {
      if (ctx) lastContext = ctx;
      if (activation !== "active") return undefined;
      try {
        const vm = await runtime.ensureStarted();
        currentVm = vm;
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
    for (const name of STARTUP_POLICY_FLAGS) pi.registerFlag(name, {
      type: "string",
      description: name.startsWith("sandbox-mount-")
        ? "Session-only mount: absolute host path or JSON array; requires --sandbox"
        : "Session-only network rule or JSON string array; requires --sandbox",
    });
    pi.registerCommand("sandbox", {
      description: "Show Gondolin sandbox runtime status",
      async handler(args, ctx) {
        if (args.trim() && args.trim() !== "status") throw new Error("usage: /sandbox [status]");
        const mountText = mounts.map((m) => `${m.hostPath} -> ${m.guestPath} (${m.readOnly ? "ro" : "rw"})`).join(", ");
        const state = activation === "failed" ? "disabled" : activation;
        const reason = activation === "failed" ? `\nreason=${failedReason}` : "";
        ctx.ui.notify(`SANDBOX ${state}${reason}\nbackend=${backend}\nimage=${vmImage}\nguest-workspace=${GUEST_WORKSPACE}\nmounts=${mountText}\nnetwork=${JSON.stringify(effectivePolicy.network ?? { allow: [], deny: [] })}`, "info");
      },
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
      return guarded(ctx, (vm) => {
        const limit = Math.max(1, Math.min(params.limit ?? 100, DEFAULT_MAX_LINES));
        return executeGuestSearch(vm, [
          "/bin/bash", "-lc", GUEST_GREP, "grep-bounded", extensionPath(params.path || ".", canonicalCwd, mounts), params.pattern,
          String(limit), String(SEARCH_MAX_BYTES), params.ignoreCase ? "1" : "0", params.literal ? "1" : "0",
          String(Math.max(0, params.context ?? 0)), params.glob ?? "",
        ], signal, "No matches found", "matches", limit);
      });
    }});
    const find = local.find;
    pi.registerTool({ ...find, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.find.execute(id, params, signal, update);
      return guarded(ctx, (vm) => {
        const limit = Math.max(1, Math.min(params.limit ?? 1000, DEFAULT_MAX_LINES));
        return executeGuestSearch(vm, ["/bin/bash", "-lc", GUEST_FIND, "find-bounded", extensionPath(params.path || ".", canonicalCwd, mounts), params.pattern, String(limit), String(SEARCH_MAX_BYTES)], signal, "No files found matching pattern", "results", limit);
      });
    }});
    const ls = local.ls;
    pi.registerTool({ ...ls, async execute(id, params, signal, update, ctx) {
      if (activation === "unlatched" || activation === "inactive") return local.ls.execute(id, params, signal, update);
      return guarded(ctx, (vm) => {
        const limit = Math.max(1, Math.min(params.limit ?? 500, DEFAULT_MAX_LINES));
        return executeGuestSearch(vm, ["/bin/bash", "-lc", GUEST_LS, "ls-bounded", extensionPath(params.path || ".", canonicalCwd, mounts), String(limit), String(SEARCH_MAX_BYTES)], signal, "(empty directory)", "entries", limit);
      });
    }});

    pi.on("session_start", async (_event, ctx) => {
      lastContext = ctx;
      if (activation !== "unlatched") return;
      setSandboxStatus(ctx, "Sandbox: starting…");
      try {
      const sandboxFlag = pi.getFlag("sandbox");
      const startupFlagValues = Object.fromEntries(STARTUP_POLICY_FLAGS.map((name) => [name, pi.getFlag(name)]));
      const startupFlagsSupplied = hasStartupPolicyFlags(startupFlagValues);
      if (!isSandboxRequested(sandboxFlag, env)) {
        if (startupFlagsSupplied) {
          latchFailure("startup mount/network flags require explicit --sandbox", ctx);
          return;
        }
        activation = "inactive";
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
        if (startupFlagsSupplied && sandboxFlag !== true) throw new Error("startup mount/network flags require explicit --sandbox");
        if (!deps.createVm) canonicalCwd = await realpath(cwd);
        const inheritedOverlay = await parseSerializedSessionPolicy(env[SANDBOX_SESSION_POLICY_ENV]);
        let settingsOverlay: SandboxPolicy;
        if (deps.sandboxSettings !== undefined) {
          settingsOverlay = await parseSandboxSettings(deps.sandboxSettings);
        } else {
          const settings = SettingsManager.create(cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
          const globalSandbox = (settings.getGlobalSettings() as Record<string, unknown>).sandbox;
          const projectSandbox = (settings.getProjectSettings() as Record<string, unknown>).sandbox;
          settingsOverlay = mergePolicies(
            await parseSandboxSettings(globalSandbox, "global sandbox settings"),
            await parseSandboxSettings(projectSandbox, "project sandbox settings"),
          );
        }
        const cliOverlay = await parseStartupPolicyFlags(startupFlagValues);
        const sessionOverlay = mergePolicies(mergePolicies(inheritedOverlay, settingsOverlay), cliOverlay);
        effectivePolicy = sessionOverlay;
        sessionPolicyText = serializeSessionPolicy(sessionOverlay);
        backend = resolveBackend(effectivePolicy, env);
        mounts = policyMounts(effectivePolicy, canonicalCwd);
      } catch (error) {
        latchFailure(`policy rejected: ${errorMessage(error)}`, ctx);
        return;
      }
      const ownership = new Map(pi.getAllTools().map((tool) => [tool.name, normalizedSourcePath(tool.sourceInfo.path, cwd)]));
      const ownPath = normalizedSourcePath(import.meta.filename, cwd);
      // Profile-restricted tools are absent; only present foreign owners collide.
      const collisions = ROUTED_TOOLS.filter((name) => ownership.has(name) && ownership.get(name) !== ownPath);
      if (collisions.length) {
        latchFailure(`tool ownership collision: ${collisions.join(", ")}`, ctx);
        return;
      }
      try {
        if (!effectivePolicy.image && image === DEFAULT_IMAGE) {
          vmImage = await ensureDefaultImage(image);
        }
      } catch (error) {
        latchFailure(`image setup failed: ${errorMessage(error)}`, ctx);
        return;
      }
      if (await ensure(ctx)) {
        // Subagents are independent Pi processes. They inherit environment, not
        // extension flags, so propagate activation and validated session policy only
        // from a successfully running parent.
        inheritedSandboxMarker = process.env.PI_SANDBOX;
        process.env.PI_SANDBOX = "gondolin";
        setSandboxMarker = true;
        if (sessionPolicyText !== undefined) {
          inheritedSessionPolicy = process.env[SANDBOX_SESSION_POLICY_ENV];
          process.env[SANDBOX_SESSION_POLICY_ENV] = sessionPolicyText;
          setSessionPolicy = true;
        }
      }
    } finally {
      if (!isFailed()) setSandboxStatus(ctx, undefined);
      reportStartupStatus(_event, ctx, "sandbox", `[sandbox] ${activation}`);
    }
    });
    const oneShot = isOneShotMode();
    pi.on("session_shutdown", async () => {
      setSandboxStatus(lastContext, undefined);
      currentVm = undefined;
      if (setSandboxMarker) {
        if (inheritedSandboxMarker === undefined) delete process.env.PI_SANDBOX;
        else process.env.PI_SANDBOX = inheritedSandboxMarker;
        setSandboxMarker = false;
      }
      if (setSessionPolicy) {
        if (inheritedSessionPolicy === undefined) delete process.env[SANDBOX_SESSION_POLICY_ENV];
        else process.env[SANDBOX_SESSION_POLICY_ENV] = inheritedSessionPolicy;
        setSessionPolicy = false;
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
