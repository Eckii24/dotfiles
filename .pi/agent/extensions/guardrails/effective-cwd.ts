import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const effectiveCwdCache = new Map<string, string>();

/**
 * Resolve the cwd Guardrails should use for project-relative behavior.
 *
 * If Pi starts inside a git working tree, Guardrails treats the git root as the
 * effective cwd so repo-relative rules and project-local config apply to the
 * whole repository instead of only the launched subdirectory.
 */
export function getEffectiveCwd(cwd: string): string {
  const normalizedCwd = resolve(cwd);
  const cached = effectiveCwdCache.get(normalizedCwd);
  if (cached) return cached;

  let effectiveCwd = normalizedCwd;

  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: normalizedCwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (result.status === 0) {
      const gitRoot = result.stdout.trim();
      if (gitRoot) {
        effectiveCwd = resolve(gitRoot);
      }
    }
  } catch {
    // Not a git repo or git unavailable — fall back to the original cwd.
  }

  effectiveCwdCache.set(normalizedCwd, effectiveCwd);
  return effectiveCwd;
}
