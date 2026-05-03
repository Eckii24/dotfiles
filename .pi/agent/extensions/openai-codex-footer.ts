/**
 * OpenAI Codex Usage Footer Extension
 *
 * Footer layout:
 *   Line 1: ~/current/working/dir [• session name]
 *   Line 2: LEFT ... padding ... RIGHT
 *     LEFT:  ↑12k in  ↓8k out  67% ctx  codex: 5h 93% left | 7d 96% left
 *     RIGHT: (openai-codex)  gpt-5.4  think:high  (main)
 *   Line 3: extension statuses (if any)
 *
 * Token source:
 *   ~/.pi/agent/auth.json → openai-codex.access + openai-codex.accountId
 *
 * Endpoint:
 *   https://chatgpt.com/backend-api/wham/usage
 *
 * This appears to be an internal ChatGPT endpoint rather than a documented
 * public API, so the response shape may change.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface UsageWindow {
	usedPercent: number | null;
	resetAfterSeconds: number | null;
}

interface CodexUsageData {
	fiveHour: UsageWindow;
	sevenDay: UsageWindow;
	isLimited: boolean;
	error?: string;
}

interface CodexCredentials {
	accessToken: string;
	accountId: string;
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const AUTH_PATH = path.join(os.homedir(), ".pi", "agent", "auth.json");
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
	return `${n}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function usedToLeftPercent(value: number | null): number | null {
	if (value === null) return null;
	return clampPercent(100 - value);
}

function formatPercent(value: number | null): string {
	return value === null ? "--" : `${Math.round(clampPercent(value))}%`;
}

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

function usageColorByRemaining(leftPercent: number | null): "dim" | "warning" | "error" {
	if (leftPercent === null) return "dim";
	if (leftPercent <= 10) return "error";
	if (leftPercent <= 30) return "warning";
	return "dim";
}

function getResetAfterSeconds(window: Record<string, unknown> | null): number | null {
	const resetAfterSeconds = readNumber(window, "reset_after_seconds");
	if (resetAfterSeconds !== null) return Math.max(0, resetAfterSeconds);

	const resetAt = readNumber(window, "reset_at");
	if (resetAt === null) return null;
	const resetAtSeconds = resetAt > 100_000_000_000 ? resetAt / 1000 : resetAt;
	return Math.max(0, resetAtSeconds - Date.now() / 1000);
}

function getCredentials(): CodexCredentials | null {
	try {
		const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as Record<string, unknown>;
		const codex = auth["openai-codex"] as
			| { type?: string; access?: string; accountId?: string; account_id?: string }
			| undefined;
		if (codex?.type !== "oauth") return null;
		const accessToken = codex.access?.trim();
		const accountId = (codex.accountId ?? codex.account_id)?.trim();
		if (!accessToken || !accountId) return null;
		return { accessToken, accountId };
	} catch {
		return null;
	}
}

function isCodexProvider(ctx: ExtensionContext): boolean {
	return ctx.model?.provider === "openai-codex";
}

export default function (pi: ExtensionAPI) {
	let usageData: CodexUsageData | null = null;
	let tuiRef: { requestRender(): void } | null = null;
	let footerActive = false;
	let usageRefreshPromise: Promise<void> | null = null;

	async function fetchUsage(): Promise<void> {
		const creds = getCredentials();
		if (!creds) {
			usageData = {
				fiveHour: { usedPercent: null, resetAfterSeconds: null },
				sevenDay: { usedPercent: null, resetAfterSeconds: null },
				isLimited: false,
				error: "no auth",
			};
			return;
		}

		try {
			const res = await fetch(USAGE_URL, {
				headers: {
					accept: "*/*",
					authorization: `Bearer ${creds.accessToken}`,
					"chatgpt-account-id": creds.accountId,
				},
			});

			if (!res.ok) {
				usageData = {
					fiveHour: { usedPercent: null, resetAfterSeconds: null },
					sevenDay: { usedPercent: null, resetAfterSeconds: null },
					isLimited: false,
					error: `HTTP ${res.status}`,
				};
				return;
			}

			const json = (await res.json()) as Record<string, unknown>;
			const rateLimit = asRecord(json.rate_limit);
			if (!rateLimit) {
				usageData = {
					fiveHour: { usedPercent: null, resetAfterSeconds: null },
					sevenDay: { usedPercent: null, resetAfterSeconds: null },
					isLimited: false,
					error: "no rate-limit data",
				};
				return;
			}

			const primaryWindow = asRecord(rateLimit.primary_window);
			const secondaryWindow = asRecord(rateLimit.secondary_window);

			usageData = {
				fiveHour: {
					usedPercent: readNumber(primaryWindow, "used_percent"),
					resetAfterSeconds: getResetAfterSeconds(primaryWindow),
				},
				sevenDay: {
					usedPercent: readNumber(secondaryWindow, "used_percent"),
					resetAfterSeconds: getResetAfterSeconds(secondaryWindow),
				},
				isLimited: rateLimit.limit_reached === true || rateLimit.allowed === false,
			};
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : "fetch error";
			usageData = {
				fiveHour: { usedPercent: null, resetAfterSeconds: null },
				sevenDay: { usedPercent: null, resetAfterSeconds: null },
				isLimited: false,
				error: msg,
			};
		}
	}

	function refreshUsageInBackground(): void {
		if (!footerActive || usageRefreshPromise) return;

		usageRefreshPromise = fetchUsage()
			.catch((e: unknown) => {
				const msg = e instanceof Error ? e.message : "fetch error";
				usageData = {
					fiveHour: { usedPercent: null, resetAfterSeconds: null },
					sevenDay: { usedPercent: null, resetAfterSeconds: null },
					isLimited: false,
					error: msg,
				};
			})
			.finally(() => {
				usageRefreshPromise = null;
				if (footerActive) tuiRef?.requestRender();
			});
	}

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			tuiRef = tui;
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			const refreshTimer = setInterval(() => {
				refreshUsageInBackground();
			}, REFRESH_INTERVAL_MS);

			return {
				dispose: () => {
					unsubBranch();
					clearInterval(refreshTimer);
				},
				invalidate() {},
				render(width: number): string[] {
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
						// Ignore token aggregation failures.
					}

					const leftParts: string[] = [];

					if (totalInput > 0) leftParts.push(theme.fg("dim", `↑${fmtTokens(totalInput)} in`));
					if (totalOutput > 0) leftParts.push(theme.fg("dim", `↓${fmtTokens(totalOutput)} out`));

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
						// Ignore context usage failures.
					}

					if (!usageData) {
						leftParts.push(theme.fg("dim", "codex: …"));
					} else if (usageData.error) {
						leftParts.push(theme.fg("dim", `codex: ${usageData.error}`));
					} else {
						const fiveHourLeft = usedToLeftPercent(usageData.fiveHour.usedPercent);
						const sevenDayLeft = usedToLeftPercent(usageData.sevenDay.usedPercent);
						const lowestLeft = [fiveHourLeft, sevenDayLeft].reduce<number | null>((lowest, value) => {
							if (value === null) return lowest;
							if (lowest === null) return value;
							return Math.min(lowest, value);
						}, null);
						const usageColor = usageData.isLimited ? "error" : usageColorByRemaining(lowestLeft);
						leftParts.push(
							theme.fg(
								usageColor,
								`codex: 5h ${formatPercent(fiveHourLeft)} left | 7d ${formatPercent(sevenDayLeft)} left`,
							),
						);
					}

					const left = leftParts.join("  ");
					const rightParts: string[] = [];

					if (ctx.model?.provider) rightParts.push(theme.fg("dim", `(${ctx.model.provider})`));
					if (ctx.model?.id) rightParts.push(theme.fg("dim", ctx.model.id));

					try {
						const level = pi.getThinkingLevel() as ThinkingLevel;
						const colorKey = thinkingColorKey(level) as Parameters<typeof theme.fg>[0];
						rightParts.push(theme.fg(colorKey, `think:${level}`));
					} catch {
						// Ignore thinking level failures.
					}

					const branch = footerData.getGitBranch();
					if (branch) rightParts.push(theme.fg("dim", `(${branch})`));

					const right = rightParts.join("  ");
					const leftWidth = visibleWidth(left);
					const rightWidth = visibleWidth(right);
					const totalNeeded = leftWidth + 2 + rightWidth;

					let statsLine: string;
					if (totalNeeded <= width) {
						const padding = " ".repeat(width - leftWidth - rightWidth);
						statsLine = left + padding + right;
					} else if (leftWidth + 2 + 4 <= width) {
						const availForRight = width - leftWidth - 2;
						const plainRight = right.replace(/\x1b\[[0-9;]*m/g, "");
						const truncated = plainRight.substring(0, Math.max(0, availForRight - 1)) + "…";
						const padding = " ".repeat(Math.max(0, width - leftWidth - visibleWidth(truncated)));
						statsLine = left + padding + truncated;
					} else {
						statsLine = truncateToWidth(left, width, theme.fg("dim", "…"));
					}

					const pwdLine = theme.fg("dim", (() => {
						let pwd = process.cwd();
						const home = process.env.HOME || process.env.USERPROFILE;
						if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
						const sessionName = ctx.sessionManager.getSessionName?.();
						if (sessionName) pwd = `${pwd} • ${sessionName}`;
						return pwd;
					})());

					const lines = [truncateToWidth(pwdLine, width, theme.fg("dim", "…")), statsLine];

					const extensionStatuses = footerData.getExtensionStatuses();
					if (extensionStatuses.size > 0) {
						const sorted = Array.from(extensionStatuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => t.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
						lines.push(truncateToWidth(sorted.join(" "), width, theme.fg("dim", "…")));
					}

					return lines;
				},
			};
		});
	}

	function activate(ctx: ExtensionContext): void {
		if (footerActive) return;
		footerActive = true;
		usageData = null;
		installFooter(ctx);
		refreshUsageInBackground();
	}

	function deactivate(ctx: ExtensionContext, nextProvider?: string): void {
		if (!footerActive) return;
		footerActive = false;
		tuiRef = null;
		if (nextProvider !== "github-copilot") {
			ctx.ui.setFooter(undefined);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		if (isCodexProvider(ctx)) activate(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		const nowCodex = event.model.provider === "openai-codex";
		const wasCodex = event.previousModel?.provider === "openai-codex";

		if (nowCodex && !wasCodex) {
			activate(ctx);
		} else if (!nowCodex && wasCodex) {
			deactivate(ctx, event.model.provider);
		} else if (nowCodex && wasCodex) {
			tuiRef?.requestRender();
		}
	});

	pi.on("agent_end", () => {
		if (!footerActive) return;
		refreshUsageInBackground();
	});

	pi.on("session_shutdown", () => {
		footerActive = false;
		tuiRef = null;
		usageRefreshPromise = null;
	});
}
