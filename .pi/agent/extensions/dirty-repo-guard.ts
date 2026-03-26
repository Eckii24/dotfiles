/**
 * Dirty Repo Guard Extension
 *
 * Prevents work from continuing in a dirty git repo without explicit approval.
 *
 * Guarded paths:
 * - initial fresh startup (`pi` opening a brand-new session)
 * - session changes (`/new`, `/resume`)
 * - forks (`/fork`)
 *
 * Ralph compatibility:
 * - Ralph fresh-session loops intentionally create many `newSession()` calls.
 * - While Ralph is actively looping, it emits a temporary bypass token on
 *   `dirty-repo-guard:bypass`.
 * - The guard skips only `reason === "new"` checks while at least one bypass
 *   token is active, so manual `/new`, `/resume`, and `/fork` behavior stays
 *   unchanged outside the loop.
 * - Startup guarding uses `session_start`, which Ralph's repeated `newSession()`
 *   calls do not trigger, so the loop remains unaffected.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const DIRTY_REPO_GUARD_BYPASS_EVENT = "dirty-repo-guard:bypass";
const STARTUP_GUARD_STATE_KEY = "__piDirtyRepoGuardStartupChecked";

type DirtyRepoGuardBypassEvent = {
	token?: string;
	active?: boolean;
	source?: string;
};

type DirtyRepoState = {
	changedFiles: number;
};

function getStartupGuardState(): { checked: boolean } {
	const globalState = globalThis as typeof globalThis & {
		[STARTUP_GUARD_STATE_KEY]?: { checked: boolean };
	};

	if (!globalState[STARTUP_GUARD_STATE_KEY]) {
		globalState[STARTUP_GUARD_STATE_KEY] = { checked: false };
	}

	return globalState[STARTUP_GUARD_STATE_KEY]!;
}

async function getDirtyRepoState(pi: ExtensionAPI, ctx: ExtensionContext): Promise<DirtyRepoState | undefined> {
	const { stdout, code } = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd });

	if (code !== 0) {
		// Not a git repo, allow the action.
		return;
	}

	const changedFiles = stdout.trim().split("\n").filter(Boolean).length;
	if (changedFiles === 0) {
		return;
	}

	return { changedFiles };
}

async function shouldCancelForDirtyRepo(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	action: string,
): Promise<boolean> {
	const state = await getDirtyRepoState(pi, ctx);
	if (!state) {
		return false;
	}

	if (!ctx.hasUI) {
		return true;
	}

	const choice = await ctx.ui.select(`You have ${state.changedFiles} uncommitted file(s). ${action} anyway?`, [
		"Yes, proceed anyway",
		"No, let me commit first",
	]);

	if (choice === "Yes, proceed anyway") {
		return false;
	}

	ctx.ui.notify("Commit your changes first", "warning");
	return true;
}

function isFreshStartupSession(ctx: ExtensionContext): boolean {
	return !ctx.sessionManager.getBranch().some((entry) => entry.type === "message");
}

export default function (pi: ExtensionAPI) {
	const activeBypassTokens = new Set<string>();
	const startupGuardState = getStartupGuardState();

	pi.events.on(DIRTY_REPO_GUARD_BYPASS_EVENT, (data) => {
		const payload = data as DirtyRepoGuardBypassEvent | undefined;
		if (!payload?.token) return;

		if (payload.active) {
			activeBypassTokens.add(payload.token);
		} else {
			activeBypassTokens.delete(payload.token);
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (startupGuardState.checked) {
			return;
		}
		startupGuardState.checked = true;

		if (!isFreshStartupSession(ctx)) {
			return;
		}

		const cancel = await shouldCancelForDirtyRepo(pi, ctx, "start pi");
		if (!cancel) {
			return;
		}

		if (!ctx.hasUI) {
			process.stderr.write("[dirty-repo-guard] Commit your changes first\n");
		}
		ctx.shutdown();
	});

	pi.on("session_before_switch", async (event, ctx) => {
		if (event.reason === "new" && activeBypassTokens.size > 0) {
			return;
		}

		const action = event.reason === "new" ? "start a new session" : "switch sessions";
		const cancel = await shouldCancelForDirtyRepo(pi, ctx, action);
		return cancel ? { cancel: true } : undefined;
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		const cancel = await shouldCancelForDirtyRepo(pi, ctx, "fork");
		return cancel ? { cancel: true } : undefined;
	});

	pi.on("session_shutdown", async () => {
		activeBypassTokens.clear();
	});
}
