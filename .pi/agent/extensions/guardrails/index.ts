// Guardrails Extension — Main Entry Point
//
// A Pi extension that adds configurable security guardrails around built-in tool
// invocations. It does not replace OS-level sandboxing, but it provides strong
// policy checks and confirmation prompts for common risky operations.
//
// What it guards:
// - read  -> `paths.confirmRead` requires confirmation
// - write -> `paths.allowWrite` whitelist + `paths.confirmWrite` confirmation list
// - edit  -> same rules as `write`
// - bash  -> `bash.confirm` command checks + path-based read/write detection
//
// Bash parsing:
// - AST-based via shfmt when available (no false positives on quoted strings)
// - Falls back to string-based parsing when shfmt is not installed
//
// Confirmation behavior:
// - Matching `confirmRead`, `confirmWrite`, or blocked `allowWrite` rules triggers a confirmation dialog.
// - Bash violations offer three choices:
//   - Allow once (y/Enter)
//   - Allow for session (a) — skips future prompts for the same exact command in the same cwd scope
//   - Deny (n/Esc)
// - If no confirmation is given before timeout, the operation is blocked.
// - Default timeout is 300000 ms (5 minutes), configurable via `timeout`.
//
// Path behavior:
// - File targets are resolved the same way Pi does, against `ctx.cwd`.
// - Relative guardrail patterns and project-local config are resolved against
//   Guardrails' effective cwd.
// - When Pi starts inside a git repo subdirectory, Guardrails uses the git
//   root as that effective cwd so project-scoped rules apply to the whole repo.
// - Checks both lexical and canonical (realpath) paths to prevent symlink
//   bypasses.
// - `allowWrite` semantics:
//   - undefined -> unrestricted writes (except `confirmWrite`)
//   - []        -> no paths auto-allowed; every write needs confirmation
//   - patterns  -> matching paths are auto-allowed; others need confirmation
// - `confirmWrite` always wins over `allowWrite`.
//
// Bash behavior:
// - When shfmt is available, parses commands into an AST for accurate analysis.
//   This eliminates false positives from quoted strings, comments, and string
//   arguments (e.g., echo "don't rm -rf" won't flag rm).
// - When shfmt is unavailable, falls back to string-based parsing that handles
//   common separators and nesting forms, including:
//   - `&&`, `||`, `;`, pipes, newlines
//   - subshells: `(cmd1; cmd2)`
//   - command substitution: `$(...)`, backticks
//   - wrappers: `bash -c`, `sh -c`, `eval`, `sudo`, `exec`, `xargs`
//   - prefixes: `time`, `nice`, `timeout`, `env`, etc.
// - Both paths track simple `cd dir && ...` changes so relative file targets
//   are checked against the effective shell cwd.
// - Detects common file reads against `paths.confirmRead`.
// - Detects common file writes against both `paths.allowWrite` and
//   `paths.confirmWrite`.
//
// Session allow-list:
// - When user chooses "Allow for session" on a bash command, the exact command string
//   is remembered for the current session together with its cwd scope.
// - Future identical commands in the same scope skip the confirmation prompt entirely.
// - The allow-list is cleared when the session ends.
//
// Config sources (merged, later entries take precedence):
// - ~/.pi/agent/guardrails.json
// - ~/.pi/agent/settings.json#guardrails
// - <effective cwd>/.pi/guardrails.json
// - <effective cwd>/.pi/settings.json#guardrails
// Settings-based sources override legacy guardrails.json within the same scope.
//
// Example configs:
//
// 1) Typical project setup
// {
//   "timeout": 300000,
//   "paths": {
//     "confirmRead": [
//       "**/.env",
//       "**/.env.*",
//       "~/.ssh/**",
//       "~/.aws/**"
//     ],
//     "allowWrite": [
//       "./**",
//       "/tmp/**"
//     ],
//     "confirmWrite": [
//       "**/.env",
//       "**/.env.*",
//       "**/.git/**",
//       "**/node_modules/**",
//       "**/*.pem",
//       "**/*.key"
//     ]
//   },
//   "bash": {
//     "deny": [
//       "rm",
//       "sudo",
//       "dd",
//       "mkfs",
//       "chmod",
//       "chown"
//     ]
//   }
// }
//
// 2) Locked-down mode
// {
//   "timeout": 300000,
//   "paths": {
//     "confirmRead": ["**/.env", "~/.ssh/**"],
//     "allowWrite": [],
//     "confirmWrite": ["**/*"]
//   },
//   "bash": {
//     "deny": ["rm", "sudo", "dd", "mkfs", "curl", "wget"]
//   }
// }
//
// Notes:
// - `allowWrite` omitted => unrestricted writes except paths in `confirmWrite`
// - `allowWrite: []`   => no writes are auto-allowed; every write requires confirmation
// - project config overrides global config field-by-field
//
// Commands:
// - /guardrails -> shows the effective merged configuration for the current cwd
//
// Important limitations:
// - Bash analysis is best-effort and intentionally conservative.
// - AST parsing requires shfmt to be installed (checked at session start).
// - Variable expansion, aliases, shell functions cannot be resolved.
// - For hard isolation, combine this extension with OS-level sandboxing.
//
// Note:
// - This header intentionally uses line comments instead of a block comment.
//   Glob patterns like `**/.env` or `**/*` contain `*/`, which would terminate
//   a `/* ... */` comment early and break TypeScript parsing.


import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { getConfigSourceInfo, loadConfig } from "./config.js";
import { getEffectiveCwd } from "./effective-cwd.js";
import { checkRead, checkWrite } from "./path-guard.js";
import { checkBash, isShfmtAvailable } from "./bash-guard.js";
import { evaluateBashCommandGates } from "./command-gates.js";
import { buildPreflightPrompt, DEFAULT_PREFLIGHT_MODEL, DEFAULT_PREFLIGHT_TIMEOUT_MS, formatPreflightRulesForDisplay, runPreflightJudge } from "./preflight.js";
import { SessionAllowList } from "./session-allow-list.js";
import { SessionPreflightRules } from "./session-preflight-rules.js";
import { SessionPreflightApprovals } from "./session-preflight-approvals.js";
import type { GuardrailsConfig, BashViolation } from "./types.js";
import { DEFAULT_TIMEOUT } from "./types.js";

const HERDR_BLOCKED_EVENT = "herdr:blocked";
const DECISION_ENTRY_TYPE = "guardrails-decision";

function allowWriteLabel(config: GuardrailsConfig): string {
  const aw = config.paths?.allowWrite;
  if (aw === undefined) return "(unrestricted)";
  if (aw.length === 0) return "(confirmation required for all writes)";
  return aw.join(", ");
}

function configSourceLabel(cwd: string): string {
  const info = getConfigSourceInfo(cwd);
  return info.activeSources.length > 0 ? info.activeSources.join(" + ") : "defaults only";
}

function scopeLabel(cwd: string): string {
  const effectiveCwd = getEffectiveCwd(cwd);
  return effectiveCwd === cwd ? effectiveCwd : `${effectiveCwd} (git root)`;
}

// ─── Confirmation result type ───

type ConfirmResult = "allow" | "allow-session" | "deny";

/**
 * Show a three-option confirmation dialog for bash violations.
 * Returns "allow", "allow-session", or "deny".
 */
async function confirmBashViolation(
  command: string,
  violations: BashViolation[],
  ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
  timeout: number,
): Promise<ConfirmResult> {
  const violationTexts = violations.map(v => {
    if (v.type === "denied_command") {
      return `• Denied command: ${v.command}`;
    } else if (v.type === "file_read_detected") {
      return `• File read detected: ${v.details}`;
    } else if (v.type === "preflight_flagged") {
      return `• Preflight flagged: ${v.details}`;
    } else {
      return `• File write detected: ${v.details}`;
    }
  });

  const result = await ctx.ui.custom<ConfirmResult>(
    (_tui, theme, _kb, done) => {
      let timedOut = false;
      let remaining = Math.ceil(timeout / 1000);

      const timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          timedOut = true;
          clearInterval(timer);
          done("deny");
        }
      }, 1000);

      return {
        render: (width: number) => {
          const accentLine = theme.fg("accent", "─".repeat(Math.min(width, 60)));
          const warningLine = theme.fg("warning", "─".repeat(Math.min(width, 60)));
          const countdownText = remaining <= 30
            ? theme.fg("error", ` (${remaining}s)`)
            : theme.fg("dim", ` (${remaining}s)`);
          const wrapWithPrefixes = (
            text: string,
            firstPrefix: string,
            continuationPrefix: string,
            style: (text: string) => string,
          ) => {
            const prefixWidth = Math.max(firstPrefix.length, continuationPrefix.length);
            const wrapped = wrapTextWithAnsi(text, Math.max(1, width - prefixWidth));
            return wrapped.map((line, index) => style(`${index === 0 ? firstPrefix : continuationPrefix}${line}`));
          };

          const lines: string[] = [
            warningLine,
            theme.fg("warning", theme.bold("  🛡️ Guardrails — Bash Confirmation")) + countdownText,
            warningLine,
            "",
            theme.fg("text", "  Command:"),
            ...wrapWithPrefixes(command, "    ", "    ", (text) => theme.fg("dim", text)),
            "",
            theme.fg("text", "  Violations:"),
            ...violationTexts.flatMap((violation) =>
              wrapWithPrefixes(violation, "  ", "    ", (text) => theme.fg("warning", text)),
            ),
            "",
            accentLine,
            ...wrapWithPrefixes(
              `${theme.fg("accent", "y/Enter")} allow once  •  ${theme.fg("accent", "a")} allow for session  •  ${theme.fg("accent", "n/Esc")} deny`,
              "  ",
              "  ",
              (text) => text,
            ),
            accentLine,
          ];

          return lines;
        },
        invalidate: () => {},
        handleInput: (data: string) => {
          if (timedOut) return;

          if (data === "y" || data === "Y" || data === "\r" || data === "\n") {
            clearInterval(timer);
            done("allow");
          } else if (data === "a" || data === "A") {
            clearInterval(timer);
            done("allow-session");
          } else if (data === "n" || data === "N" || data === "\x1b") {
            clearInterval(timer);
            done("deny");
          }
        },
      };
    },
  );

  if (result === "allow" || result === "allow-session" || result === "deny") {
    return result;
  }

  const choice = await ctx.ui.select(
    [
      "🛡️ Guardrails — Bash Confirmation",
      "",
      `Command: ${command}`,
      "",
      "Violations:",
      ...violationTexts,
      "",
      "Choose an action:",
    ].join("\n"),
    ["Allow once", "Allow for session", "Deny"],
    { timeout },
  );

  if (choice === "Allow once") return "allow";
  if (choice === "Allow for session") return "allow-session";
  return "deny";
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag("no-guardrails", {
    description: "Disable Guardrails for this session",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("no-preflight-guardrails", {
    description: "Disable Guardrails Gate-2 preflight model checks for this session",
    type: "boolean",
    default: false,
  });

  let config: GuardrailsConfig = { timeout: DEFAULT_TIMEOUT, paths: {}, bash: {} };
  const sessionAllow = new SessionAllowList();
  const sessionPreflightRules = new SessionPreflightRules();
  const sessionPreflightApprovals = new SessionPreflightApprovals();
  let guardrailsEnabled = !Boolean(pi.getFlag("no-guardrails"));
  let preflightEnabled = !Boolean(pi.getFlag("no-preflight-guardrails"));

  function guardrailsDisabled(): boolean {
    return !guardrailsEnabled;
  }

  function preflightDisabled(): boolean {
    return guardrailsDisabled() || !preflightEnabled;
  }

  function recordDecision(
    ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1],
    action: string,
    data: Record<string, unknown> = {},
  ): void {
    try {
      pi.appendEntry(DECISION_ENTRY_TYPE, {
        action,
        cwd: ctx.cwd,
        effectiveCwd: getEffectiveCwd(ctx.cwd),
        timestamp: new Date().toISOString(),
        ...data,
      });
    } catch {
      // Decision persistence must never affect tool execution.
    }
  }

  function restoreSessionAllows(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]): number {
    const entries = ctx.sessionManager.getBranch() as Array<{
      type: string;
      customType?: string;
      data?: unknown;
    }>;
    const restored = new Map<string, { scope: string; command: string }>();

    for (const entry of entries) {
      if (entry.type !== "custom" || entry.customType !== DECISION_ENTRY_TYPE) continue;
      if (typeof entry.data !== "object" || entry.data === null) continue;

      const data = entry.data as { action?: unknown; effectiveCwd?: unknown; command?: unknown };
      if (typeof data.action !== "string" || typeof data.effectiveCwd !== "string" || typeof data.command !== "string") continue;

      const key = `${data.effectiveCwd}\u0000${data.command}`;
      if (data.action.endsWith("allowed-session")) {
        restored.set(key, { scope: data.effectiveCwd, command: data.command });
      } else if (data.action.includes("denied") || data.action.includes("blocked")) {
        restored.delete(key);
      }
    }

    for (const { scope, command } of restored.values()) {
      sessionAllow.allowCommand(scope, command);
    }
    return restored.size;
  }

  function restoreSessionPreflightApprovals(ctx: Parameters<Parameters<ExtensionAPI["on"]>[1]>[1]): number {
    const entries = ctx.sessionManager.getBranch() as Array<{ type: string; customType?: string; data?: unknown }>;

    for (const entry of entries) {
      if (entry.type !== "custom" || entry.customType !== DECISION_ENTRY_TYPE) continue;
      if (typeof entry.data !== "object" || entry.data === null) continue;
      const approval = (entry.data as { preflightApproval?: unknown }).preflightApproval;
      if (typeof approval !== "object" || approval === null) continue;

      const data = approval as { scope?: unknown; command?: unknown; intent?: unknown; reason?: unknown; riskSignals?: unknown; createdAt?: unknown };
      if (typeof data.scope !== "string" || typeof data.command !== "string" || typeof data.intent !== "string" || typeof data.reason !== "string" || !Array.isArray(data.riskSignals) || !data.riskSignals.every((signal) => typeof signal === "string")) continue;
      sessionPreflightApprovals.add({
        scope: data.scope,
        command: data.command,
        intent: data.intent,
        reason: data.reason,
        riskSignals: data.riskSignals,
        createdAt: typeof data.createdAt === "string" ? data.createdAt : undefined,
      });
    }
    return sessionPreflightApprovals.size;
  }

  function refreshConfig(cwd: string, force = false): GuardrailsConfig {
    config = loadConfig(cwd, { force });
    return config;
  }

  // Load config on session start
  pi.on("session_start", async (_event, ctx) => {
    config = refreshConfig(ctx.cwd, true);
    sessionAllow.clear();
    sessionPreflightApprovals.clear();
    const restoredAllows = restoreSessionAllows(ctx);
    const restoredPreflightApprovals = restoreSessionPreflightApprovals(ctx);

    const t = ctx.ui.theme;
    const astAvailable = isShfmtAvailable();
    const parserLabel = astAvailable ? "AST (shfmt)" : "string-based (fallback)";

    const header = t.fg("mdHeading", "[Guardrails]");
    const lines: string[] = [header];

    lines.push(t.fg("dim", `  Disabled:    ${guardrailsDisabled() ? "yes" : "no"}`));
    lines.push(t.fg("dim", `  Gate 2:      ${preflightDisabled() ? "disabled" : "enabled"}`));

    if (config.paths?.confirmRead?.length) {
      lines.push(t.fg("dim", `  Confirm Read:   ${config.paths.confirmRead.join(", ")}`));
    }
    if (config.paths?.allowWrite !== undefined) {
      lines.push(t.fg("dim", `  Allow Write: ${allowWriteLabel(config)}`));
    }
    if (config.paths?.confirmWrite?.length) {
      lines.push(t.fg("dim", `  Confirm Write:  ${config.paths.confirmWrite.join(", ")}`));
    }
    if (config.bash?.confirm?.length) {
      lines.push(t.fg("dim", `  Bash Confirm: ${config.bash.confirm.join(", ")}`));
    }
    if (config.bash?.preflightRules?.length) {
      lines.push(t.fg("dim", `  Gate 2 rules: ${formatPreflightRulesForDisplay(config.bash.preflightRules)}`));
    }
    lines.push(t.fg("dim", `  Scope:       ${scopeLabel(ctx.cwd)}`));
    lines.push(t.fg("dim", `  Config:      ${configSourceLabel(ctx.cwd)}`));
    lines.push(t.fg("dim", `  Parser:      ${parserLabel}`));
    if (restoredAllows > 0 || restoredPreflightApprovals > 0) {
      lines.push(t.fg("dim", `  Restored:    ${restoredAllows} exact allow(s), ${restoredPreflightApprovals} preflight approval(s)`));
    }

    recordDecision(ctx, "session-start", {
      disabled: guardrailsDisabled(),
      preflightDisabled: preflightDisabled(),
      restoredAllows,
    });

    if (lines.length === 1) {
      lines.push(t.fg("dim", `  No rules configured [${parserLabel}]`));
    }

    ctx.ui.notify(lines.join("\n"), "info");
  });

  // Main tool_call interceptor
  pi.on("tool_call", async (event, ctx) => {
    const currentConfig = refreshConfig(ctx.cwd);
    const patternCwd = getEffectiveCwd(ctx.cwd);
    const timeout = currentConfig.timeout ?? DEFAULT_TIMEOUT;

    if (guardrailsDisabled()) {
      return undefined;
    }

    // ─── Read Guard ───
    if (isToolCallEventType("read", event)) {
      const filePath = event.input.path;
      const result = checkRead(filePath, ctx.cwd, currentConfig, { patternCwd });

      if (!result.allowed && result.requiresConfirmation) {
        if (!ctx.hasUI) {
          recordDecision(ctx, "read-blocked-no-ui", { toolName: "read", path: filePath, reason: result.reason });
          return { block: true, reason: `[Guardrails] Read blocked (no UI): ${result.reason}` };
        }

        pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: "Guardrails — read confirmation needed" });

        const confirmed = await (async () => {
          try {
            return await ctx.ui.confirm(
              "🛡️ Guardrails — Read Confirmation",
              `Reading this file requires confirmation:\n\n  ${filePath}\n\nReason: ${result.reason}\n\nAllow this read?`,
              { timeout }
            );
          } finally {
            pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
          }
        })();

        if (!confirmed) {
          recordDecision(ctx, "read-denied", { toolName: "read", path: filePath, reason: result.reason });
          return {
            block: true,
            reason: `[Guardrails] Read denied by user or timed out after ${Math.round(timeout / 1000)}s: ${result.reason}`,
          };
        }

        recordDecision(ctx, "read-allowed-once", { toolName: "read", path: filePath, reason: result.reason });
      }
    }

    // ─── Write / Edit Guard ───
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const filePath = event.input.path;
      const result = checkWrite(filePath, ctx.cwd, currentConfig, { patternCwd });

      if (!result.allowed) {
        if (result.requiresConfirmation) {
          if (!ctx.hasUI) {
            recordDecision(ctx, "write-blocked-no-ui", { toolName: event.toolName, path: filePath, reason: result.reason });
            return { block: true, reason: `[Guardrails] Write blocked (no UI): ${result.reason}` };
          }

          pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: "Guardrails — write confirmation needed" });

          const confirmed = await (async () => {
            try {
              return await ctx.ui.confirm(
                "🛡️ Guardrails — Write Confirmation",
                `Writing to this file requires confirmation:\n\n  ${filePath}\n\nReason: ${result.reason}\n\nAllow this write?`,
                { timeout }
              );
            } finally {
              pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
            }
          })();

          if (!confirmed) {
            recordDecision(ctx, "write-denied", { toolName: event.toolName, path: filePath, reason: result.reason });
            return {
              block: true,
              reason: `[Guardrails] Write denied by user or timed out after ${Math.round(timeout / 1000)}s: ${result.reason}`,
            };
          }

          recordDecision(ctx, "write-allowed-once", { toolName: event.toolName, path: filePath, reason: result.reason });
        } else {
          if (ctx.hasUI) {
            ctx.ui.notify(`🛡️ Write blocked: ${filePath}\n${result.reason}`, "warning");
          }
          recordDecision(ctx, "write-blocked", { toolName: event.toolName, path: filePath, reason: result.reason });
          return {
            block: true,
            reason: `[Guardrails] Write blocked: ${result.reason}`,
          };
        }
      }
    }

    // ─── Bash Guard ───
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      const sessionScope = getEffectiveCwd(ctx.cwd);

      // Hard bash checks always run before a session approval can suppress a prompt.
      const result = checkBash(command, ctx.cwd, currentConfig, { patternCwd });
      if (sessionAllow.isAllowed(sessionScope, command)) {
        recordDecision(ctx, "bash-allowed-session-reuse", { toolName: "bash", command, checkedViolations: result.violations });
        return undefined;
      }

      if (!result.allowed) {
        const activeViolations = result.violations;

        if (!ctx.hasUI) {
          const reasons = activeViolations.map(v => `  • ${v.details ?? v.command}`).join("\n");
          recordDecision(ctx, "bash-blocked-no-ui", { toolName: "bash", command, violations: activeViolations });
          return {
            block: true,
            reason: `[Guardrails] Bash blocked (no UI):\n${reasons}`,
          };
        }

        pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: "Guardrails — bash confirmation needed" });

        const confirmResult = await (async () => {
          try {
            return await confirmBashViolation(command, activeViolations, ctx, timeout);
          } finally {
            pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
          }
        })();

        if (confirmResult === "allow-session") {
          sessionAllow.allowCommand(sessionScope, command);

          ctx.ui.notify(
            `🛡️ Allowed for session${sessionAllow.size > 1 ? ` (${sessionAllow.size} rules)` : ""}`,
            "info",
          );
          recordDecision(ctx, "bash-allowed-session", { toolName: "bash", command, violations: activeViolations });
          return undefined;
        }

        if (confirmResult === "deny") {
          const violationLines = activeViolations.map(v => {
            if (v.type === "denied_command") return `  • Denied command: ${v.command}`;
            if (v.type === "file_read_detected") return `  • File read detected: ${v.details}`;
            if (v.type === "preflight_flagged") return `  • Preflight flagged: ${v.details}`;
            return `  • File write detected: ${v.details}`;
          }).join("\n");

          recordDecision(ctx, "bash-denied", { toolName: "bash", command, violations: activeViolations });
          return {
            block: true,
            reason: `[Guardrails] Bash denied by user or timed out after ${Math.round(timeout / 1000)}s:\n${violationLines}`,
          };
        }

        // "allow" — allow this one time, continue
        recordDecision(ctx, "bash-allowed-once", { toolName: "bash", command, violations: activeViolations });
        return undefined;
      }

      const gateResult = evaluateBashCommandGates(command, ctx.cwd, currentConfig);
      if (gateResult.decision === "allow") {
        return undefined;
      }

      if (preflightDisabled()) {
        recordDecision(ctx, "bash-preflight-disabled-allowed", { toolName: "bash", command, gate1Reason: gateResult.reason, gate1Hints: gateResult.hints });
        return undefined;
      }

      const preflightModel = currentConfig.bash?.preflightModel ?? DEFAULT_PREFLIGHT_MODEL;
      const preflightPrompt = buildPreflightPrompt({
        command,
        cwd: ctx.cwd,
        effectiveCwd: sessionScope,
        recentContext: "", // Do not forward chat/session text into the preflight subprocess.
        gate1Reason: gateResult.reason,
        gate1Hints: gateResult.hints,
        preflightRules: [...(currentConfig.bash?.preflightRules ?? []), ...sessionPreflightRules.rules],
        sessionAllowedCommands: sessionAllow.commandsForScope(sessionScope),
        sessionPreflightApprovals: sessionPreflightApprovals.approvalsForScope(sessionScope),
      });

      let preflightVerdict: Awaited<ReturnType<typeof runPreflightJudge>>;
      try {
        preflightVerdict = await runPreflightJudge({
          cwd: sessionScope,
          model: preflightModel,
          prompt: preflightPrompt,
          timeoutMs: Math.min(timeout, DEFAULT_PREFLIGHT_TIMEOUT_MS),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallbackViolation: BashViolation = {
          type: "preflight_flagged",
          command: command.split(/\s+/)[0] || command,
          segment: command,
          details: `Gate-2 judge error (${preflightModel}): ${message}`,
        };

        if (!ctx.hasUI) {
          recordDecision(ctx, "bash-preflight-error-blocked-no-ui", { toolName: "bash", command, violation: fallbackViolation });
          return {
            block: true,
            reason: `[Guardrails] Bash blocked: Gate-2 preflight failed without UI:\n  • ${fallbackViolation.details}`,
          };
        }

        pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: "Guardrails — Gate-2 preflight judge failed; confirmation needed" });
        const confirmResult = await (async () => {
          try {
            return await confirmBashViolation(command, [fallbackViolation], ctx, timeout);
          } finally {
            pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
          }
        })();

        if (confirmResult === "allow-session") {
          sessionAllow.allowCommand(sessionScope, command);
          ctx.ui.notify(
            `🛡️ Allowed for session${sessionAllow.size > 1 ? ` (${sessionAllow.size} rules)` : ""}`,
            "info",
          );
          recordDecision(ctx, "bash-preflight-error-allowed-session", { toolName: "bash", command, violation: fallbackViolation });
          return undefined;
        }

        if (confirmResult === "deny") {
          recordDecision(ctx, "bash-preflight-error-denied", { toolName: "bash", command, violation: fallbackViolation });
          return {
            block: true,
            reason: `[Guardrails] Bash denied after Gate-2 preflight failure:\n  • ${fallbackViolation.details}`,
          };
        }

        recordDecision(ctx, "bash-preflight-error-allowed-once", { toolName: "bash", command, violation: fallbackViolation });
        return undefined;
      }

      if (preflightVerdict.decision === "allow") {
        recordDecision(ctx, "bash-preflight-allowed", { toolName: "bash", command, preflightVerdict });
        return undefined;
      }

      const verdictDetails = [preflightVerdict.reason, ...preflightVerdict.concerns].filter(Boolean).join("; ");
      const verdictViolation: BashViolation = {
        type: "preflight_flagged",
        command: command.split(/\s+/)[0] || command,
        segment: command,
        details: `Gate-2 (${preflightModel}) => ${preflightVerdict.decision.toUpperCase()}: ${verdictDetails}`,
      };

      if (!ctx.hasUI) {
        recordDecision(ctx, "bash-preflight-blocked-no-ui", { toolName: "bash", command, preflightVerdict, violation: verdictViolation });
        return {
          block: true,
          reason: `[Guardrails] Bash blocked by Gate-2 preflight (no UI):\n  • ${verdictViolation.details}`,
        };
      }

      pi.events.emit(HERDR_BLOCKED_EVENT, { active: true, label: "Guardrails — bash preflight confirmation needed" });

      const confirmResult = await (async () => {
        try {
          return await confirmBashViolation(command, [verdictViolation], ctx, timeout);
        } finally {
          pi.events.emit(HERDR_BLOCKED_EVENT, { active: false });
        }
      })();

      if (confirmResult === "allow-session") {
        sessionAllow.allowCommand(sessionScope, command);
        const preflightApproval = sessionPreflightApprovals.add({
          scope: sessionScope,
          command,
          intent: preflightVerdict.approvalIntent,
          reason: preflightVerdict.reason,
          riskSignals: gateResult.hints,
        });
        ctx.ui.notify(
          `🛡️ Allowed for session${preflightApproval ? `; saved intent approval (${sessionPreflightApprovals.size})` : ""}`,
          "info",
        );
        recordDecision(ctx, "bash-preflight-allowed-session", { toolName: "bash", command, preflightVerdict, violation: verdictViolation, preflightApproval });
        return undefined;
      }

      if (confirmResult === "deny") {
        recordDecision(ctx, "bash-preflight-denied", { toolName: "bash", command, preflightVerdict, violation: verdictViolation });
        return {
          block: true,
          reason: `[Guardrails] Bash denied by preflight after ${Math.round(timeout / 1000)}s:\n  • ${verdictViolation.details}`,
        };
      }

      recordDecision(ctx, "bash-preflight-allowed-once", { toolName: "bash", command, preflightVerdict, violation: verdictViolation });
    }

    return undefined;
  });

  // ─── /guardrails command ───
  pi.registerCommand("guardrails", {
    description: "Show configuration or toggle this session: /guardrails on|off|status",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "on" || action === "off") {
        guardrailsEnabled = action === "on";
        recordDecision(ctx, `guardrails-session-${action}`);
        ctx.ui.notify(`🛡️ Guardrails ${guardrailsEnabled ? "enabled" : "disabled"} for this session`, "info");
        return;
      }
      if (action && action !== "status") {
        ctx.ui.notify("Usage: /guardrails [on|off|status]", "warning");
        return;
      }
      const cfg = refreshConfig(ctx.cwd, true);
      const astAvailable = isShfmtAvailable();
      const lines = [
        "🛡️ Guardrails Configuration",
        "",
        `Scope: ${scopeLabel(ctx.cwd)}`,
        `Config source: ${configSourceLabel(ctx.cwd)}`,
        `Timeout: ${(cfg.timeout ?? DEFAULT_TIMEOUT) / 1000}s`,
        `Bash parser: ${astAvailable ? "AST (shfmt)" : "string-based (fallback)"}`,
        `Session exact allows: ${sessionAllow.size}`,
        `Session preflight approvals: ${sessionPreflightApprovals.size}`,
        "",
        "─── Paths ───",
        `Confirm Read:   ${cfg.paths?.confirmRead?.length ? cfg.paths.confirmRead.join(", ") : "(none)"}`,
        `Allow Write: ${allowWriteLabel(cfg)}`,
        `Confirm Write:  ${cfg.paths?.confirmWrite?.length ? cfg.paths.confirmWrite.join(", ") : "(none)"}`,
        "",
        "─── Bash ───",
        `Confirm:     ${cfg.bash?.confirm?.length ? cfg.bash.confirm.join(", ") : "(none)"}`,
        `Gate 1 allow: ${cfg.bash?.allow?.length ? cfg.bash.allow.join(", ") : "(defaults only)"}`,
        `Gate 2 model: ${cfg.bash?.preflightModel ?? DEFAULT_PREFLIGHT_MODEL}`,
        `Gate 2 rules: ${formatPreflightRulesForDisplay(cfg.bash?.preflightRules)}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("guardrails-preflight", {
    description: "Control Gate-2: on|off|status|rule <text>|rules",
    handler: async (args, ctx) => {
      const raw = args.trim();
      const action = raw.toLowerCase();
      if (action === "rule" || action.startsWith("rule ")) {
        const result = sessionPreflightRules.add(raw.slice("rule".length));
        if (!result.added) {
          ctx.ui.notify(`Cannot add session preflight rule: ${result.error}`, "warning");
          return;
        }
        recordDecision(ctx, "guardrails-preflight-rule-added", { rule: sessionPreflightRules.rules.at(-1) });
        ctx.ui.notify(`🛡️ Added Gate 2 session rule: ${sessionPreflightRules.rules.at(-1)}`, "info");
        return;
      }
      if (action === "rules") {
        const configured = refreshConfig(ctx.cwd).bash?.preflightRules ?? [];
        const approvals = sessionPreflightApprovals.approvalsForScope(getEffectiveCwd(ctx.cwd));
        const lines = [
          "🛡️ Gate 2 rules and session approvals",
          `Configured: ${formatPreflightRulesForDisplay(configured)}`,
          `Session rules: ${formatPreflightRulesForDisplay(sessionPreflightRules.rules)}`,
          `Session approvals: ${approvals.length > 0 ? approvals.map((approval) => `${approval.command} → ${approval.intent}`).join(" | ") : "(none)"}`,
        ];
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (action === "on" || action === "off") {
        preflightEnabled = action === "on";
        recordDecision(ctx, `guardrails-preflight-session-${action}`);
        ctx.ui.notify(`🛡️ Gate 2 preflight ${preflightEnabled ? "enabled" : "disabled"} for this session`, "info");
        return;
      }
      ctx.ui.notify(`🛡️ Gate 2 preflight: ${preflightDisabled() ? "disabled" : "enabled"}\nUsage: /guardrails-preflight [on|off|status|rule <text>|rules]`, action && action !== "status" ? "warning" : "info");
    },
  });
}

