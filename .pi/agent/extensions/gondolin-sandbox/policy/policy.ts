import { GUEST_WORKSPACE } from "../core";

export type Mount = {
  hostPath: string;
  guestPath: string;
  required?: boolean;
};

export type SandboxPolicy = {
  backend?: "qemu" | "krun";
  image?: string;
  workspace?: { mode: "ro" | "rw" | "none" };
  mounts?: { readOnly?: Mount[]; readWrite?: Mount[] };
  environment?: Record<string, string>;
  network?: { allow?: string[]; deny?: string[] };
  ssh?: { enabled: boolean };
};

export class PolicyError extends Error {}

export const normalizeAbsolute = (value: string): string => {
  const normalized = value.trim().replace(/\/+$/, "") || "/";
  if (!normalized.startsWith("/")) throw new PolicyError(`path must be absolute: ${value}`);
  const parts: string[] = [];
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new PolicyError(`path must be normalized: ${value}`);
    parts.push(part);
  }
  return `/${parts.join("/")}`;
};

export const normalizePattern = (value: string): string => value.trim().toLowerCase().replace(/\.$/, "");

const patternMatches = (hostname: string, pattern: string): boolean => {
  const host = normalizePattern(hostname);
  const rule = normalizePattern(pattern);
  return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) && host !== rule.slice(2) : host === rule;
};

export function isNetworkAllowed(hostname: string, policy: SandboxPolicy): boolean {
  const deny = policy.network?.deny ?? [];
  if (deny.some((rule) => patternMatches(hostname, rule))) return false;
  return (policy.network?.allow ?? []).some((rule) => patternMatches(hostname, rule));
}

export const normalizeMount = (mount: Mount): Mount => ({
  hostPath: normalizeAbsolute(mount.hostPath),
  guestPath: normalizeAbsolute(mount.guestPath),
  required: mount.required ?? false,
});

export function mergePolicies(globalPolicy: SandboxPolicy, projectPolicy: SandboxPolicy): SandboxPolicy {
  const ro = [...(globalPolicy.mounts?.readOnly ?? []), ...(projectPolicy.mounts?.readOnly ?? [])].map(normalizeMount);
  const rw = [...(globalPolicy.mounts?.readWrite ?? []), ...(projectPolicy.mounts?.readWrite ?? [])].map(normalizeMount);
  const dedupeMounts = (mounts: Mount[]) => [...mounts.reduce((result, mount) => {
    const key = `${mount.hostPath}\0${mount.guestPath}`;
    const prior = result.get(key);
    result.set(key, prior ? { ...mount, required: Boolean(prior.required || mount.required) } : mount);
    return result;
  }, new Map<string, Mount>()).values()]
    .sort((a, b) => a.guestPath.localeCompare(b.guestPath) || a.hostPath.localeCompare(b.hostPath));
  const normalizedRo = dedupeMounts(ro);
  const normalizedRw = dedupeMounts(rw);
  const guestPaths = new Map<string, { hostPath: string; mode: "ro" | "rw" }>();
  for (const [mode, mounts] of [["ro", normalizedRo], ["rw", normalizedRw]] as const) {
    for (const mount of mounts) {
      if (mount.guestPath === GUEST_WORKSPACE) throw new PolicyError(`mount guest-path reserved: ${GUEST_WORKSPACE}`);
      const prior = guestPaths.get(mount.guestPath);
      if (prior && (prior.hostPath !== mount.hostPath || prior.mode !== mode)) {
        throw new PolicyError(`mount guest-path conflict: ${mount.guestPath}`);
      }
      guestPaths.set(mount.guestPath, { hostPath: mount.hostPath, mode });
    }
  }
  const dedupeRules = (rules: string[]) => [...new Set(rules.map(normalizePattern))].sort();
  return {
    ...(globalPolicy.backend === undefined ? {} : { backend: globalPolicy.backend }),
    ...(globalPolicy.image === undefined ? {} : { image: globalPolicy.image }),
    ...(globalPolicy.workspace === undefined ? {} : { workspace: globalPolicy.workspace }),
    ...(globalPolicy.ssh === undefined ? {} : { ssh: globalPolicy.ssh }),
    ...(projectPolicy.backend === undefined ? {} : { backend: projectPolicy.backend }),
    ...(projectPolicy.image === undefined ? {} : { image: projectPolicy.image }),
    ...(projectPolicy.workspace === undefined ? {} : { workspace: projectPolicy.workspace }),
    ...(projectPolicy.ssh === undefined ? {} : { ssh: projectPolicy.ssh }),
    ...(globalPolicy.environment === undefined && projectPolicy.environment === undefined ? {} : {
      environment: { ...(globalPolicy.environment ?? {}), ...(projectPolicy.environment ?? {}) },
    }),
    mounts: { readOnly: normalizedRo, readWrite: normalizedRw },
    network: {
      allow: dedupeRules([...(globalPolicy.network?.allow ?? []), ...(projectPolicy.network?.allow ?? [])]),
      deny: dedupeRules([...(globalPolicy.network?.deny ?? []), ...(projectPolicy.network?.deny ?? [])]),
    },
  };
}
