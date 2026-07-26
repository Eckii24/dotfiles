import { lstat, mkdir, open, readFile, readlink, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { normalizeAbsolute, normalizeMount, mergePolicies, type Mount } from "./policy";
import { fingerprintSandbox, verifyProjectApproval } from "./approvals";
import { validateHostPattern, validateSandbox } from "./loader";

export type MutationKind = "mount-ro" | "mount-rw" | "network-allow" | "network-deny";
export type MutationPaths = {
  settingsPath: string;
  approvalsPath: string;
  lockPath: string;
  projectId: string;
  globalAgentDir?: string;
  expectedGlobalTarget?: string;
};
export type MutationRequest = {
  kind: MutationKind;
  action: "add" | "remove";
  value: string;
  guestPath?: string;
  required?: boolean;
  scope: "global" | "project";
  paths: MutationPaths;
  hooks?: { afterSettingsCommit?: () => void | Promise<void> };
};
type JsonObject = Record<string, any>;

const readJson = async (path: string): Promise<JsonObject> => JSON.parse(await readFile(path, "utf8")) as JsonObject;
const syncDirectory = async (path: string): Promise<void> => {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error: any) {
    if (!["EINVAL", "ENOTSUP", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  } finally { await handle?.close(); }
};
const atomicWriteText = async (path: string, content: string, expectedCurrent?: string): Promise<void> => {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (expectedCurrent !== undefined && await readFile(path, "utf8") !== expectedCurrent) throw new Error("settings changed concurrently");
    await rename(temp, path);
    await syncDirectory(directory);
  } finally {
    await handle?.close();
    await rm(temp, { force: true });
  }
};
const atomicWriteJson = async (path: string, value: unknown, expectedCurrent?: string): Promise<void> =>
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`, expectedCurrent);

const withLock = async <T>(lockPath: string, operation: () => Promise<T>): Promise<T> => {
  try { await mkdir(lockPath); }
  catch (error: any) {
    if (error?.code === "EEXIST") throw new Error("policy lock contention (bounded failure; remove stale lock after verifying no writer is active)");
    throw error;
  }
  try { return await operation(); }
  finally { await rm(lockPath, { recursive: true, force: true }); }
};

const resolveSettingsTarget = async (request: MutationRequest): Promise<string> => {
  const info = await lstat(request.paths.settingsPath);
  if (!info.isSymbolicLink()) return request.paths.settingsPath;
  if (request.scope === "project") throw new Error("project settings symlink forbidden");
  const rawTarget = await readlink(request.paths.settingsPath);
  const directTarget = isAbsolute(rawTarget) ? resolve(rawTarget) : resolve(dirname(request.paths.settingsPath), rawTarget);
  const targetInfo = await lstat(directTarget);
  if (targetInfo.isSymbolicLink()) throw new Error("multi-hop global settings symlink forbidden");
  if (!targetInfo.isFile()) throw new Error("global settings symlink target must be a regular file");
  const agentDir = await realpath(request.paths.globalAgentDir ?? dirname(request.paths.settingsPath));
  const target = await realpath(directTarget);
  const within = relative(agentDir, target);
  if (within.startsWith("..") || isAbsolute(within)) throw new Error("global settings symlink target outside agent directory");
  if (!request.paths.expectedGlobalTarget) throw new Error("expected global yadm alternate target required");
  const expected = await realpath(request.paths.expectedGlobalTarget);
  if (target !== expected) throw new Error("unexpected global settings symlink target");
  return target;
};

const mutateMounts = async (sandbox: JsonObject, request: MutationRequest): Promise<void> => {
  const key = request.kind === "mount-ro" ? "readOnly" : "readWrite";
  sandbox.mounts ??= {};
  const mounts: Mount[] = sandbox.mounts[key] ??= [];
  if (request.action === "add") {
    const canonicalHost = await realpath(request.value);
    const candidate = normalizeMount({ hostPath: canonicalHost, guestPath: request.guestPath ?? canonicalHost, required: request.required ?? false });
    const allModes = [sandbox.mounts.readOnly ?? [], sandbox.mounts.readWrite ?? []] as Mount[][];
    for (const existing of allModes.flat()) {
      if (normalizeMount(existing).guestPath === candidate.guestPath) throw new Error(`mount guest-path conflict: ${candidate.guestPath}`);
    }
    mounts.push(candidate);
    return;
  }
  const needle = normalizeAbsolute(request.value);
  const index = mounts.findIndex((mount) => {
    const normalized = normalizeMount(mount);
    return normalized.hostPath === needle || normalized.guestPath === needle;
  });
  if (index < 0) throw new Error("exact normalized mount not found");
  mounts.splice(index, 1);
};

const mutateNetwork = (sandbox: JsonObject, request: MutationRequest): void => {
  const key = request.kind === "network-allow" ? "allow" : "deny";
  sandbox.network ??= {};
  const rules: string[] = sandbox.network[key] ??= [];
  const needle = validateHostPattern(request.value);
  const normalized = [...new Set(rules.map(validateHostPattern))].sort();
  if (request.action === "add") {
    if (!normalized.includes(needle)) normalized.push(needle);
    sandbox.network[key] = normalized.sort();
  } else {
    const index = normalized.indexOf(needle);
    if (index < 0) throw new Error("exact normalized network rule not found");
    normalized.splice(index, 1);
    sandbox.network[key] = normalized;
  }
};
const readTextIfExists = async (path: string): Promise<string | undefined> => {
  try { return await readFile(path, "utf8"); }
  catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
};

export async function mutatePolicy(request: MutationRequest): Promise<{ scope: "global" | "project"; message: string }> {
  return withLock(request.paths.lockPath, async () => {
    const settingsTarget = await resolveSettingsTarget(request);
    const settingsBefore = await readFile(settingsTarget, "utf8");
    const approvalsBefore = request.scope === "project" ? await readTextIfExists(request.paths.approvalsPath) : undefined;
    const settings = JSON.parse(settingsBefore) as JsonObject;
    settings.sandbox ??= {};
    if (request.scope === "project") {
      const approvals = approvalsBefore === undefined ? {} : JSON.parse(approvalsBefore) as JsonObject;
      const approved = approvals.projects?.[request.paths.projectId]?.fingerprint as string | undefined;
      if (!verifyProjectApproval(settings.sandbox, approved)) throw new Error(`stale or unapproved project sandbox policy: ${request.paths.projectId}`);
    }
    settings.sandbox = await validateSandbox(settings.sandbox);
    if (request.kind.startsWith("mount-")) await mutateMounts(settings.sandbox, request);
    else mutateNetwork(settings.sandbox, request);
    mergePolicies(settings.sandbox, {}); // validates cross-mode guest-path uniqueness before any write
    let settingsCommitted = false;
    try {
      await atomicWriteJson(settingsTarget, settings, settingsBefore);
      settingsCommitted = true;
      await request.hooks?.afterSettingsCommit?.();
      if (request.scope === "project") {
        const approvals = approvalsBefore === undefined ? {} : JSON.parse(approvalsBefore) as JsonObject;
        approvals.projects ??= {};
        approvals.projects[request.paths.projectId] = { fingerprint: fingerprintSandbox(settings.sandbox) };
        await atomicWriteJson(request.paths.approvalsPath, approvals, approvalsBefore);
      }
    } catch (error) {
      if (settingsCommitted) await atomicWriteText(settingsTarget, settingsBefore);
      if (request.scope === "project") {
        if (approvalsBefore === undefined) await rm(request.paths.approvalsPath, { force: true });
        else await atomicWriteText(request.paths.approvalsPath, approvalsBefore);
      }
      throw error;
    }
    return { scope: request.scope, message: "effective next session; restart required" };
  });
}
