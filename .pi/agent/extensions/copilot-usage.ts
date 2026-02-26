/**
 * Copilot Usage Footer Extension
 *
 * Replaces the default token-count footer with GitHub Copilot premium
 * request usage: per-session delta and billing-period total (used/limit).
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
 *   - Once at session start (sets the session baseline)
 *   - After every agent turn  (agent_end)
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
					// Same User-Agent as the oh-my-posh segment and official tooling
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

	// -------------------------------------------------------------------------
	// Footer rendering
	// -------------------------------------------------------------------------

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;

			// Re-render whenever the git branch changes (e.g. after a checkout)
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			// Periodic background refresh every 5 minutes
			const refreshTimer = setInterval(async () => {
				await fetchUsage();
				tui.requestRender();
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
					// Reimplement default footer layout but replace the cost amount with
					// Copilot request counts. This preserves context usage, tokens, model,
					// thinking level and provider info while swapping the $... field.

					// --- Gather cumulative usage from session entries ---
					let totalInput = 0;
					let totalOutput = 0;
					let totalCacheRead = 0;
					let totalCacheWrite = 0;

					try {
						for (const entry of ctx.sessionManager.getEntries()) {
							if (entry.type === "message" && entry.message.role === "assistant") {
								totalInput += entry.message.usage.input ?? 0;
								totalOutput += entry.message.usage.output ?? 0;
								totalCacheRead += entry.message.usage.cacheRead ?? 0;
								totalCacheWrite += entry.message.usage.cacheWrite ?? 0;
							}
						}
					} catch {
						// Defensive: if sessionManager API differs, fall back to zeroes
					}

					const statsParts: string[] = [];
					if (totalInput) statsParts.push(`↑${Math.max(0, totalInput)}`);
					if (totalOutput) statsParts.push(`↓${Math.max(0, totalOutput)}`);
					if (totalCacheRead) statsParts.push(`R${Math.max(0, totalCacheRead)}`);
					if (totalCacheWrite) statsParts.push(`W${Math.max(0, totalCacheWrite)}`);

					// Replace cost with Copilot request count
					if (!copilotData) {
						statsParts.push(theme.fg("dim", "copilot: loading…"));
					} else if (copilotData.error) {
						statsParts.push(theme.fg("dim", `copilot: ${copilotData.error}`));
					} else {
						const sessionDelta =
							sessionStartUsed !== null
								? copilotData.premium.used - sessionStartUsed
								: 0;

						if (copilotData.premium.unlimited) {
							statsParts.push(theme.fg("dim", `copilot: +${sessionDelta} session | ∞ unlimited`));
						} else {
							const { used, limit } = copilotData.premium;
							const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
							const usageStr = pct >= 90 ? theme.fg("error", `${used}/${limit}`) : theme.fg("dim", `${used}/${limit}`);
							statsParts.push(theme.fg("dim", `copilot: +${sessionDelta} session | `) + usageStr + theme.fg("dim", ` total (${pct}%)`));
						}
					}

					let statsLeft = statsParts.join(" ");

					// --- Build right side: provider/model + git branch + thinking ---
					const branch = footerData.getGitBranch();
					const branchStr = branch ? ` (${branch})` : "";
					let rightSideWithoutProvider = ctx.model?.id ?? "no-model";
					if (ctx.model?.reasoning) {
						const thinkingLevel = pi.getFlag ? (pi.getFlag("thinking") as string | undefined) : undefined;
						// Fall back to showing the thinking level if available in ctx
						const level = (ctx as any).thinkingLevel ?? undefined;
						rightSideWithoutProvider = `${rightSideWithoutProvider}`;
					}

					let right = theme.fg("dim", `${rightSideWithoutProvider}${branchStr}`);

					// If there are multiple providers, prepend provider in parentheses (like default)
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
						const prov = `(${ctx.model.provider}) ` + rightSideWithoutProvider;
						// Only use provider prefix if it fits
						if (visibleWidth(statsLeft) + 2 + visibleWidth(prov) <= width) {
							right = theme.fg("dim", `${prov}${branchStr}`);
						}
					}

					// --- Truncate and align ---
					let statsLeftWidth = visibleWidth(statsLeft);
					if (statsLeftWidth > width) {
						const plainStatsLeft = statsLeft.replace(/\x1b\[[0-9;]*m/g, "");
						statsLeft = `${plainStatsLeft.substring(0, width - 3)}...`;
						statsLeftWidth = visibleWidth(statsLeft);
					}

					const minPadding = 2;
					const rightSideWidth = visibleWidth(right);
					const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
						statsLine = statsLeft + padding + right;
					} else {
						const availableForRight = width - statsLeftWidth - minPadding;
						if (availableForRight > 3) {
							const plainRight = right.replace(/\x1b\[[0-9;]*m/g, "");
							const truncatedPlain = plainRight.substring(0, availableForRight);
							const padding = " ".repeat(width - statsLeftWidth - truncatedPlain.length);
							statsLine = statsLeft + padding + truncatedPlain;
						} else {
							statsLine = statsLeft;
						}
					}

					const dimStatsLeft = theme.fg("dim", statsLeft);
					const remainder = statsLine.slice(statsLeft.length); // padding + right
					const dimRemainder = theme.fg("dim", remainder);

					const lines = [theme.fg("dim", (() => {
						let pwd = process.cwd();
						const home = process.env.HOME || process.env.USERPROFILE;
						if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
						const sessionName = ctx.sessionManager.getSessionName?.();
						if (sessionName) pwd = `${pwd} • ${sessionName}`;
						return pwd;
					})()), dimStatsLeft + dimRemainder];

					// Add extension statuses on a single line, sorted alphabetically
					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sorted = Array.from(extensionStatuses.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, t]) => t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
						lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "...")));
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

	async function activate(ctx: ExtensionContext): Promise<void> {
		if (footerActive) return;
		footerActive = true;
		sessionStartUsed = null; // baseline resets whenever we (re-)activate
		await fetchUsage();
		installFooter(ctx);
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

	pi.on("session_start", async (_event, ctx) => {
		if (isCopilotProvider(ctx)) await activate(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		// Treat every session switch as a clean slate regardless of direction
		footerActive = false;
		tuiRef = null;
		if (isCopilotProvider(ctx)) await activate(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		const nowCopilot = event.model.provider === "github-copilot";
		const wasCopilot = event.previousModel?.provider === "github-copilot";

		if (nowCopilot && !wasCopilot) {
			await activate(ctx);
		} else if (!nowCopilot && wasCopilot) {
			deactivate(ctx);
		}
	});

	pi.on("agent_end", async () => {
		if (!footerActive) return;
		// Refresh after each turn; Copilot usage may have changed in the editor too
		await fetchUsage();
		tuiRef?.requestRender();
	});
}
