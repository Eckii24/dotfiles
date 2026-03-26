/**
 * Dirty Repo Guard Extension
 *
 * Prevents session changes when there are uncommitted git changes.
 * Useful to ensure work is committed before switching context.
 *
 * Ralph compatibility:
 * - Ralph fresh-session loops intentionally create many `newSession()` calls.
 * - While Ralph is actively looping, it emits a temporary bypass token on
 *   `dirty-repo-guard:bypass`.
 * - The guard skips only `reason === "new"` checks while at least one bypass
 *   token is active, so manual `/new`, `/resume`, and `/fork` behavior stays
 *   unchanged outside the loop.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DIRTY_REPO_GUARD_BYPASS_EVENT = "dirty-repo-guard:bypass";

type DirtyRepoGuardBypassEvent = {
	token?: string;
	active?: boolean;
	source?: string;
};

async function checkDirtyRepo(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: string,
): Promise<{ cancel: boolean } | undefined> {
	// Check for uncommitted changes
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);

	if (code !== 0) {
		// Not a git repo, allow the action
		return;
	}

	const hasChanges = stdout.trim().length > 0;
	if (!hasChanges) {
		return;
	}

	if (!ctx.hasUI) {
		// In non-interactive mode, block by default
		return { cancel: true };
	}

	// Count changed files
	const changedFiles = stdout.trim().split("\n").filter(Boolean).length;

	const choice = await ctx.ui.select(`You have ${changedFiles} uncommitted file(s). ${action} anyway?`, [
		"Yes, proceed anyway",
		"No, let me commit first",
	]);

	if (choice !== "Yes, proceed anyway") {
		ctx.ui.notify("Commit your changes first", "warning");
		return { cancel: true };
	}
}

export default function (pi: ExtensionAPI) {
	const activeBypassTokens = new Set<string>();

	pi.events.on(DIRTY_REPO_GUARD_BYPASS_EVENT, (data) => {
		const payload = data as DirtyRepoGuardBypassEvent | undefined;
		if (!payload?.token) return;

		if (payload.active) {
			activeBypassTokens.add(payload.token);
		} else {
			activeBypassTokens.delete(payload.token);
		}
	});

	pi.on("session_before_switch", async (event, ctx) => {
		if (event.reason === "new" && activeBypassTokens.size > 0) {
			return;
		}

		const action = event.reason === "new" ? "new session" : "switch session";
		return checkDirtyRepo(pi, ctx, action);
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		return checkDirtyRepo(pi, ctx, "fork");
	});

	pi.on("session_shutdown", async () => {
		activeBypassTokens.clear();
	});
}
