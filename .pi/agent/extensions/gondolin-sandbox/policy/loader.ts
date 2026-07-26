import { lstat, readFile, realpath } from "node:fs/promises";
import { verifyProjectApproval } from "./approvals";
import { mergePolicies, normalizeAbsolute, normalizePattern, type Mount, type SandboxPolicy } from "./policy";

const SANDBOX_KEYS = new Set(["backend", "image", "workspace", "mounts", "environment", "network", "ssh"]);
const SECRET_NAME = /(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|PRIVATE_?KEY)(?:_|$)/i;
const IMAGE_DIGEST = /^[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type LoadPaths = { globalPath: string; projectPath: string; approvalsPath: string; projectId: string };
type JsonObject = Record<string, unknown>;

const readJson = async (path: string): Promise<JsonObject> => JSON.parse(await readFile(path, "utf8")) as JsonObject;
const readJsonIfExists = async (path: string): Promise<JsonObject | undefined> => {
  try { return await readJson(path); }
  catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
};
const assertRegularProjectSettings = async (path: string): Promise<void> => {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("project settings symlink forbidden");
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
};
const object = (value: unknown, where: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} must be an object`);
  return value as JsonObject;
};
const onlyKeys = (value: JsonObject, keys: readonly string[], where: string): void => {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`unknown ${where} key: ${key}`);
};
const stringArray = (value: unknown, where: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${where} must be a string array`);
  return value;
};
export const validateHostPattern = (input: string): string => {
  const pattern = normalizePattern(input);
  const hostname = pattern.startsWith("*.") ? pattern.slice(2) : pattern;
  if (hostname.length === 0 || hostname.length > 253 || !hostname.includes(".") || hostname.split(".").some((label) => !HOST_LABEL.test(label))) {
    throw new Error(`invalid host pattern: ${input}`);
  }
  return pattern;
};

const canonicalizeMounts = async (value: unknown): Promise<NonNullable<SandboxPolicy["mounts"]>> => {
  const mounts = object(value, "mounts");
  onlyKeys(mounts, ["readOnly", "readWrite"], "mounts");
  const result: NonNullable<SandboxPolicy["mounts"]> = {};
  for (const key of ["readOnly", "readWrite"] as const) {
    if (mounts[key] === undefined) continue;
    if (!Array.isArray(mounts[key])) throw new Error(`mounts.${key} must be an array`);
    const output: Mount[] = [];
    for (const raw of mounts[key]) {
      const mount = object(raw, `mounts.${key} entry`);
      onlyKeys(mount, ["hostPath", "guestPath", "required"], `mounts.${key} entry`);
      if (typeof mount.hostPath !== "string" || typeof mount.guestPath !== "string") throw new Error("mount hostPath and guestPath must be strings");
      if (mount.required !== undefined && typeof mount.required !== "boolean") throw new Error("mount required must be boolean");
      const required = mount.required === true;
      let hostPath: string;
      try { hostPath = await realpath(normalizeAbsolute(mount.hostPath)); }
      catch (error: any) {
        if (error?.code === "ENOENT" && !required) continue;
        if (error?.code === "ENOENT") throw new Error(`required mount host path does not exist: ${mount.hostPath}`);
        throw error;
      }
      output.push({ hostPath, guestPath: normalizeAbsolute(mount.guestPath), required });
    }
    result[key] = output;
  }
  return result;
};

export const validateSandbox = async (input: unknown): Promise<SandboxPolicy> => {
  const sandbox = object(input, "sandbox");
  for (const key of Object.keys(sandbox)) if (!SANDBOX_KEYS.has(key)) throw new Error(`unknown sandbox key: ${key}`);
  const result: SandboxPolicy = {};
  if (sandbox.backend !== undefined) {
    if (sandbox.backend !== "qemu" && sandbox.backend !== "krun") throw new Error("backend must be qemu or krun");
    result.backend = sandbox.backend;
  }
  if (sandbox.image !== undefined) {
    if (typeof sandbox.image !== "string" || !IMAGE_DIGEST.test(sandbox.image)) throw new Error("image must be pinned by sha256 digest");
    result.image = sandbox.image;
  }
  if (sandbox.workspace !== undefined) {
    const workspace = object(sandbox.workspace, "workspace");
    onlyKeys(workspace, ["mode"], "workspace");
    if (workspace.mode !== "ro" && workspace.mode !== "rw" && workspace.mode !== "none") throw new Error("workspace.mode must be ro, rw, or none");
    result.workspace = { mode: workspace.mode };
  }
  if (sandbox.mounts !== undefined) result.mounts = await canonicalizeMounts(sandbox.mounts);
  if (sandbox.environment !== undefined) {
    const environment = object(sandbox.environment, "environment");
    for (const [name, value] of Object.entries(environment)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new Error(`invalid environment name: ${name}`);
      if (SECRET_NAME.test(name)) throw new Error(`secret-like environment name forbidden: ${name}`);
      if (typeof value !== "string") throw new Error(`environment value must be string: ${name}`);
    }
    result.environment = environment as Record<string, string>;
  }
  if (sandbox.network !== undefined) {
    const network = object(sandbox.network, "network");
    onlyKeys(network, ["allow", "deny"], "network");
    result.network = {};
    if (network.allow !== undefined) result.network.allow = stringArray(network.allow, "network.allow").map(validateHostPattern);
    if (network.deny !== undefined) result.network.deny = stringArray(network.deny, "network.deny").map(validateHostPattern);
  }
  if (sandbox.ssh !== undefined) {
    const ssh = object(sandbox.ssh, "ssh");
    onlyKeys(ssh, ["enabled"], "ssh");
    if (typeof ssh.enabled !== "boolean") throw new Error("ssh.enabled must be boolean");
    result.ssh = { enabled: ssh.enabled };
  }
  return result;
};

export async function loadApprovedEffectivePolicy(paths: LoadPaths): Promise<SandboxPolicy> {
  const globalSettings = await readJson(paths.globalPath);
  await assertRegularProjectSettings(paths.projectPath);
  const projectSettings = await readJsonIfExists(paths.projectPath);
  const rawGlobalSandbox = globalSettings.sandbox ?? {};
  const rawProjectSandbox = projectSettings?.sandbox;
  const globalSandbox = await validateSandbox(rawGlobalSandbox);
  if (rawProjectSandbox === undefined) return mergePolicies(globalSandbox, {});
  const approvals = await readJsonIfExists(paths.approvalsPath) ?? {};
  const projects = approvals.projects === undefined ? undefined : object(approvals.projects, "approvals.projects");
  const approval = projects?.[paths.projectId] === undefined ? undefined : object(projects[paths.projectId], "project approval");
  const approved = typeof approval?.fingerprint === "string" ? approval.fingerprint : undefined;
  if (!verifyProjectApproval(rawProjectSandbox, approved)) throw new Error(`stale or unapproved project sandbox policy: ${paths.projectId}`);
  return mergePolicies(globalSandbox, await validateSandbox(rawProjectSandbox));
}
