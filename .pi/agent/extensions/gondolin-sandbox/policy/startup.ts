import { realpath } from "node:fs/promises";
import { mergePolicies, normalizeAbsolute, validateHostPattern, type Mount, type SandboxPolicy } from "./policy";

export const SANDBOX_SESSION_POLICY_ENV = "PI_SANDBOX_SESSION_POLICY_V1";
export const MAX_SANDBOX_SESSION_POLICY_BYTES = 64 * 1024;
export const STARTUP_POLICY_FLAGS = [
  "sandbox-mount-ro",
  "sandbox-mount-rw",
  "sandbox-network-allow",
  "sandbox-network-deny",
] as const;

export type StartupPolicyFlag = typeof STARTUP_POLICY_FLAGS[number];
export type StartupPolicyFlagValues = Partial<Record<StartupPolicyFlag, unknown>>;
type StartupDependencies = { realpath?: (path: string) => Promise<string> };
type JsonObject = Record<string, unknown>;

const object = (value: unknown, where: string): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${where} must be an object`);
  return value as JsonObject;
};
const onlyKeys = (value: JsonObject, allowed: readonly string[], where: string): void => {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw new Error(`unknown ${where} key: ${key}`);
};
const decodeValues = (raw: unknown, flag: StartupPolicyFlag): unknown[] => {
  if (typeof raw !== "string") throw new Error(`--${flag} requires a string value`);
  const value = raw.trim();
  if (!value) throw new Error(`--${flag} value must not be empty`);
  if (!value.startsWith("[")) return [value];
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error(`--${flag} contains invalid JSON`); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error(`--${flag} JSON value must be a non-empty array`);
  return parsed;
};
const mountInput = (value: unknown, flag: StartupPolicyFlag): { hostPath: string; guestPath?: string; required: boolean } => {
  if (typeof value === "string") return { hostPath: value, required: false };
  const mount = object(value, `--${flag} mount entry`);
  onlyKeys(mount, ["hostPath", "guestPath", "required"], `--${flag} mount entry`);
  if (typeof mount.hostPath !== "string") throw new Error(`--${flag} mount hostPath must be a string`);
  if (mount.guestPath !== undefined && typeof mount.guestPath !== "string") throw new Error(`--${flag} mount guestPath must be a string`);
  if (mount.required !== undefined && typeof mount.required !== "boolean") throw new Error(`--${flag} mount required must be boolean`);
  return { hostPath: mount.hostPath, ...(mount.guestPath === undefined ? {} : { guestPath: mount.guestPath }), required: mount.required === true };
};
const parseMounts = async (raw: unknown, flag: StartupPolicyFlag, deps: StartupDependencies): Promise<Mount[]> => {
  const canonicalize = deps.realpath ?? realpath;
  const mounts: Mount[] = [];
  for (const value of decodeValues(raw, flag)) {
    const input = mountInput(value, flag);
    const requestedHost = normalizeAbsolute(input.hostPath);
    let hostPath: string;
    try { hostPath = await canonicalize(requestedHost); }
    catch { throw new Error(`--${flag} host path does not exist or cannot be resolved: ${requestedHost}`); }
    mounts.push({ hostPath, guestPath: input.guestPath === undefined ? hostPath : normalizeAbsolute(input.guestPath), required: input.required });
  }
  return mounts;
};
const parseRules = (raw: unknown, flag: StartupPolicyFlag): string[] => decodeValues(raw, flag).map((value) => {
  if (typeof value !== "string") throw new Error(`--${flag} entries must be strings`);
  return validateHostPattern(value);
});

export const hasStartupPolicyFlags = (values: StartupPolicyFlagValues): boolean =>
  STARTUP_POLICY_FLAGS.some((name) => values[name] !== undefined);

/** Parse user-authorized CLI values into a canonical session-only policy overlay. */
export async function parseStartupPolicyFlags(values: StartupPolicyFlagValues, deps: StartupDependencies = {}): Promise<SandboxPolicy> {
  const overlay: SandboxPolicy = {};
  const ro = values["sandbox-mount-ro"];
  const rw = values["sandbox-mount-rw"];
  const allow = values["sandbox-network-allow"];
  const deny = values["sandbox-network-deny"];
  if (ro !== undefined || rw !== undefined) overlay.mounts = {
    ...(ro === undefined ? {} : { readOnly: await parseMounts(ro, "sandbox-mount-ro", deps) }),
    ...(rw === undefined ? {} : { readWrite: await parseMounts(rw, "sandbox-mount-rw", deps) }),
  };
  if (allow !== undefined || deny !== undefined) overlay.network = {
    ...(allow === undefined ? {} : { allow: parseRules(allow, "sandbox-network-allow") }),
    ...(deny === undefined ? {} : { deny: parseRules(deny, "sandbox-network-deny") }),
  };
  return mergePolicies({}, overlay);
}

/** Strictly revalidate an inherited session overlay before a child VM can use it. */
export async function parseSerializedSessionPolicy(raw: string | undefined): Promise<SandboxPolicy> {
  if (raw === undefined) return mergePolicies({}, {});
  if (Buffer.byteLength(raw, "utf8") > MAX_SANDBOX_SESSION_POLICY_BYTES) throw new Error("inherited sandbox session policy exceeds 64KB");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error("inherited sandbox session policy is invalid JSON"); }
  const policy = object(parsed, "inherited sandbox session policy");
  onlyKeys(policy, ["mounts", "network"], "inherited sandbox session policy");
  const values: StartupPolicyFlagValues = {};
  if (policy.mounts !== undefined) {
    const mounts = object(policy.mounts, "inherited sandbox session policy mounts");
    onlyKeys(mounts, ["readOnly", "readWrite"], "inherited sandbox session policy mounts");
    if (mounts.readOnly !== undefined) values["sandbox-mount-ro"] = JSON.stringify(mounts.readOnly);
    if (mounts.readWrite !== undefined) values["sandbox-mount-rw"] = JSON.stringify(mounts.readWrite);
  }
  if (policy.network !== undefined) {
    const network = object(policy.network, "inherited sandbox session policy network");
    onlyKeys(network, ["allow", "deny"], "inherited sandbox session policy network");
    if (network.allow !== undefined) values["sandbox-network-allow"] = JSON.stringify(network.allow);
    if (network.deny !== undefined) values["sandbox-network-deny"] = JSON.stringify(network.deny);
  }
  return parseStartupPolicyFlags(values);
}

const compactPolicy = (policy: SandboxPolicy): SandboxPolicy => {
  const readOnly = policy.mounts?.readOnly ?? [];
  const readWrite = policy.mounts?.readWrite ?? [];
  const allow = policy.network?.allow ?? [];
  const deny = policy.network?.deny ?? [];
  return {
    ...(readOnly.length || readWrite.length ? { mounts: { ...(readOnly.length ? { readOnly } : {}), ...(readWrite.length ? { readWrite } : {}) } } : {}),
    ...(allow.length || deny.length ? { network: { ...(allow.length ? { allow } : {}), ...(deny.length ? { deny } : {}) } } : {}),
  };
};

export function serializeSessionPolicy(policy: SandboxPolicy): string | undefined {
  const compact = compactPolicy(policy);
  if (!compact.mounts && !compact.network) return undefined;
  const value = JSON.stringify(compact);
  if (Buffer.byteLength(value, "utf8") > MAX_SANDBOX_SESSION_POLICY_BYTES) throw new Error("sandbox session policy exceeds 64KB");
  return value;
}
