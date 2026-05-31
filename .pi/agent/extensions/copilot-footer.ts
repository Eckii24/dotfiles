/**
 * Copilot Usage Footer Extension
 *
 * Footer layout:
 *   Line 1: ~/current/working/dir [• session name]
 *   Line 2: LEFT ... padding ... RIGHT
 *     LEFT:  ↑12k in  ↓8k out  67% ctx  copilot: +3 sess | 123/300 (41%)
 *     RIGHT: (github-copilot)  claude-sonnet-4-5  think:medium  (main)
 *   Line 3: extension statuses (if any)
 *
 * Token source:
 *   ~/.pi/agent/auth.json → github-copilot.refresh  (long-lived GitHub OAuth token)
 *   NOTE: the "access" field (tid=...) is the short-lived Copilot inference token
 *   and is NOT accepted by the GitHub quota endpoint – always use "refresh".
 *
 * GitHub Enterprise support:
 *   If auth.json contains github-copilot.enterpriseUrl (a plain hostname, e.g.
 *   "company.ghe.com"), the quota endpoint switches to:
 *     https://{enterpriseUrl}/api/v3/copilot_internal/user
 *   Otherwise the standard endpoint is used:
 *     https://api.github.com/copilot_internal/user
 *
 * API response: quota_snapshots.premium_interactions.{ entitlement, remaining, unlimited }
 *
 * Refreshes:
 *   - Once at session start, in the background (sets the session baseline)
 *   - After every agent turn (agent_end), in the background
 *   - Every 5 minutes via a timer
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PremiumUsage {
	used: number;
	limit: number;
	unlimited: boolean;
}

interface CopilotData {
	premium: PremiumUsage;
	resetDate: string;
	error?: string;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format token count with k/M suffix for compact display. */
function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

/** Map a thinking level string to its theme color key. */
function thinkingColorKey(level: ThinkingLevel): string {
	const map: Record<ThinkingLevel, string> = {
		off: "thinkingOff",
		minimal: "thinkingMinimal",
		low: "thinkingLow",
		medium: "thinkingMedium",
		high: "thinkingHigh",
		xhigh: "thinkingXhigh",
	};
	return map[level] ?? "thinkingOff";
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	/** Latest snapshot fetched from the API (null = not yet fetched). */
	let copilotData: CopilotData | null = null;

	/**
	 * How many premium requests had been used when the current session started.
	 * Reset to null at the beginning of every session so the delta restarts at 0.
	 */
	let sessionStartUsed: number | null = null;

	/** TUI handle stored from inside setFooter so we can call requestRender() later. */
	let tuiRef: { requestRender(): void } | null = null;

	/** Whether the custom footer is currently installed. */
	let footerActive = false;

	/** Share one in-flight refresh across all triggers. */
	let usageRefreshPromise: Promise<void> | null = null;

	// -------------------------------------------------------------------------
	// Credentials from pi's auth.json
	// -------------------------------------------------------------------------

	interface CopilotCredentials {
		/** Long-lived GitHub OAuth token (ghu_...) used to call the quota API. */
		token: string;
		/**
		 * Plain hostname for GitHub Enterprise Server, e.g. "company.ghe.com".
		 * Undefined for standard github.com accounts.
		 */
		enterpriseUrl?: string;
	}

	function getCredentials(): CopilotCredentials | null {
		try {
			const authPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
			const raw = fs.readFileSync(authPath, "utf8");
			const auth = JSON.parse(raw) as Record<string, unknown>;
			const copilot = auth["github-copilot"] as
				| { refresh?: string; enterpriseUrl?: string }
				| undefined;
			const token = copilot?.refresh;
			if (!token) return null;
			return { token, enterpriseUrl: copilot?.enterpriseUrl };
		} catch {
			return null;
		}
	}

	function buildQuotaUrl(enterpriseUrl?: string): string {
		if (enterpriseUrl) {
			// GitHub Enterprise Server exposes the REST API under /api/v3
			return `https://${enterpriseUrl}/api/v3/copilot_internal/user`;
		}
		return "https://api.github.com/copilot_internal/user";
	}

	// -------------------------------------------------------------------------
	// API fetch
	// -------------------------------------------------------------------------

	async function fetchUsage(): Promise<void> {
		const creds = getCredentials();
		if (!creds) {
			copilotData = {
				premium: { used: 0, limit: 0, unlimited: false },
				resetDate: "",
				error: "no token",
			};
			return;
		}

		const url = buildQuotaUrl(creds.enterpriseUrl);

		try {
			const res = await fetch(url, {
				headers: {
					Authorization: `Bearer ${creds.token}`,
					"User-Agent": "GitHub-Copilot-Usage-Tray",
					Accept: "application/json",
					"Content-Type": "application/json",
				},
			});

			if (!res.ok) {
				copilotData = {
					premium: { used: 0, limit: 0, unlimited: false },
					resetDate: "",
					error: `HTTP ${res.status}`,
				};
				return;
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const json: any = await res.json();
			const prem = json?.quota_snapshots?.premium_interactions;

			if (!prem) {
				copilotData = {
					premium: { used: 0, limit: 0, unlimited: false },
					resetDate: "",
					error: "no quota data",
				};
				return;
			}

			const entitlement: number = prem.entitlement ?? 0;
			const remaining: number = prem.remaining ?? 0;
			const unlimited: boolean = Boolean(prem.unlimited);

			const used = unlimited ? 0 : Math.max(0, entitlement - remaining);

			copilotData = {
				premium: { used, limit: entitlement, unlimited },
				resetDate:
					(json.quota_reset_date as string | undefined) ??
					(json.quota_reset_date_utc as string | undefined) ??
					"",
			};

			// Record session baseline the first time we get real data
			if (sessionStartUsed === null) {
				sessionStartUsed = used;
			}
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "fetch error";
			copilotData = {
				premium: { used: 0, limit: 0, unlimited: false },
				resetDate: "",
				error: msg,
			};
		}
	}

	function refreshUsageInBackground(): void {
		if (usageRefreshPromise) return;

		usageRefreshPromise = fetchUsage()
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : "fetch error";
				copilotData = {
					premium: { used: 0, limit: 0, unlimited: false },
					resetDate: "",
					error: msg,
				};
			})
			.finally(() => {
				usageRefreshPromise = null;
				if (footerActive) {
					tuiRef?.requestRender();
				}
			});
	}

	// -------------------------------------------------------------------------
	// Footer rendering
	// -------------------------------------------------------------------------

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;

			// Re-render whenever the git branch changes
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			// Periodic background refresh every 5 minutes
			const refreshTimer = setInterval(() => {
				refreshUsageInBackground();
			}, 5 * 60 * 1000);

			return {
				dispose: () => {
					unsubBranch();
					clearInterval(refreshTimer);
				},

				invalidate() {
					// Called on theme changes – no cached state to clear
				},

				render(width: number): string[] {
					// ── Gather cumulative session token stats ──────────────────────────────
					let totalInput = 0;
					let totalOutput = 0;

					try {
						for (const entry of ctx.sessionManager.getEntries()) {
							if (entry.type === "message" && entry.message.role === "assistant") {
								totalInput += entry.message.usage.input ?? 0;
								totalOutput += entry.message.usage.output ?? 0;
							}
						}
					} catch {
						// Defensive: if sessionManager API differs, fall back to zeroes
					}

					// ── LEFT SIDE ─────────────────────────────────────────────────────────
					const leftParts: string[] = [];

					// In / Out tokens
					if (totalInput > 0) {
						leftParts.push(theme.fg("dim", `↑${fmtTokens(totalInput)} in`));
					}
					if (totalOutput > 0) {
						leftParts.push(theme.fg("dim", `↓${fmtTokens(totalOutput)} out`));
					}

					// Context window utilization
					try {
						const usage = ctx.getContextUsage();
						if (usage && usage.tokens !== null) {
							const pct = usage.percent !== null
								? Math.round(usage.percent)
								: Math.min(100, Math.round((usage.tokens / usage.contextWindow) * 100));
							const ctxColor = pct >= 90 ? "error" : pct >= 70 ? "warning" : "dim";
							leftParts.push(theme.fg(ctxColor, `${pct}% ctx`));
						}
					} catch {
						// getContextUsage may not always be available
					}

					// Copilot request usage
					if (!copilotData) {
						leftParts.push(theme.fg("dim", "copilot: …"));
					} else if (copilotData.error) {
						leftParts.push(theme.fg("dim", `copilot: ${copilotData.error}`));
					} else {
						const delta =
							sessionStartUsed !== null
								? copilotData.premium.used - sessionStartUsed
								: 0;

						if (copilotData.premium.unlimited) {
							leftParts.push(
								theme.fg("dim", `copilot: +${delta} req | ∞ unlimited`),
							);
						} else {
							const { used, limit } = copilotData.premium;
							const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
							const usageColor = pct >= 90 ? "error" : "dim";
							leftParts.push(
								theme.fg("dim", `copilot: +${delta} req | `) +
									theme.fg(usageColor, `${used}/${limit} (${pct}%)`),
							);
						}
					}

					const left = leftParts.join("  ");

					// ── RIGHT SIDE ────────────────────────────────────────────────────────
					const rightParts: string[] = [];

					// Provider (always shown)
					if (ctx.model?.provider) {
						rightParts.push(theme.fg("dim", `(${ctx.model.provider})`));
					}

					// Model
					if (ctx.model?.id) {
						rightParts.push(theme.fg("dim", ctx.model.id));
					}

					// Thinking level
					try {
						const level = pi.getThinkingLevel() as ThinkingLevel;
						const colorKey = thinkingColorKey(level) as Parameters<typeof theme.fg>[0];
						rightParts.push(theme.fg(colorKey, `think:${level}`));
					} catch {
						// getThinkingLevel may throw if not available
					}

					// Git branch
					const branch = footerData.getGitBranch();
					if (branch) {
						rightParts.push(theme.fg("dim", `(${branch})`));
					}

					const right = rightParts.join("  ");

					// ── Compose the stats line ────────────────────────────────────────────
					const leftWidth = visibleWidth(left);
					const rightWidth = visibleWidth(right);
					const totalNeeded = leftWidth + 2 + rightWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - leftWidth - rightWidth);
						statsLine = left + padding + right;
					} else if (leftWidth + 2 + 4 <= width) {
						// Not enough space for full right – truncate it
						const availForRight = width - leftWidth - 2;
						const plainRight = right.replace(/\x1b\[[0-9;]*m/g, "");
						const truncated = plainRight.substring(0, availForRight - 1) + "…";
						const padding = " ".repeat(width - leftWidth - visibleWidth(truncated));
						statsLine = left + padding + truncated;
					} else {
						// Very narrow – just show left
						statsLine = left;
					}

					// ── PWD line ─────────────────────────────────────────────────────────
					const pwdLine = theme.fg("dim", (() => {
						let pwd = process.cwd();
						const home = process.env.HOME || process.env.USERPROFILE;
						if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
						const sessionName = ctx.sessionManager.getSessionName?.();
						if (sessionName) pwd = `${pwd} • ${sessionName}`;
						return pwd;
					})());

					const lines = [pwdLine, statsLine];

					// Extension statuses on a single line, sorted alphabetically
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sorted = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) =>
								t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim(),
							);
						lines.push(
							truncateToWidth(sorted.join(" "), width, theme.fg("dim", "…")),
						);
					}

					return lines;
				},
			};
		});
	}

	// -------------------------------------------------------------------------
	// Activation helpers
	// -------------------------------------------------------------------------

	function isCopilotProvider(ctx: ExtensionContext): boolean {
		return ctx.model?.provider === "github-copilot";
	}

	function activate(ctx: ExtensionContext): void {
		if (footerActive) return;
		footerActive = true;
		sessionStartUsed = null; // baseline resets whenever we (re-)activate
		copilotData = null; // show loading state until the first async refresh completes
		installFooter(ctx);
		refreshUsageInBackground();
	}

	function deactivate(ctx: ExtensionContext): void {
		if (!footerActive) return;
		footerActive = false;
		tuiRef = null;
		ctx.ui.setFooter(undefined); // restore default footer
	}

	// -------------------------------------------------------------------------
	// Lifecycle events
	// -------------------------------------------------------------------------

	pi.on("session_start", (_event, ctx) => {
		if (isCopilotProvider(ctx)) activate(ctx);
	});

	pi.on("session_switch", (_event, ctx) => {
		// Treat every session switch as a clean slate regardless of direction
		deactivate(ctx);
		if (isCopilotProvider(ctx)) activate(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		const nowCopilot = event.model.provider === "github-copilot";
		const wasCopilot = event.previousModel?.provider === "github-copilot";

		if (nowCopilot && !wasCopilot) {
			activate(ctx);
		} else if (!nowCopilot && wasCopilot) {
			deactivate(ctx);
		} else if (nowCopilot && wasCopilot) {
			// Model or thinking level may have changed – just trigger a re-render
			tuiRef?.requestRender();
		}
	});

	pi.on("agent_end", () => {
		if (!footerActive) return;
		// Refresh after each turn; Copilot usage may have changed in the editor too
		refreshUsageInBackground();
	});
}
