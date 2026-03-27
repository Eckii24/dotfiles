// Guardrails Extension — Main Entry Point
//
// A Pi extension that adds configurable security guardrails around built-in tool
// invocations. It does not replace OS-level sandboxing, but it provides strong
// policy checks and confirmation prompts for common risky operations.
//
// What it guards:
// - read  -> `paths.denyRead` requires confirmation
// - write -> `paths.allowWrite` whitelist + `paths.denyWrite` deny list
// - edit  -> same rules as `write`
// - bash  -> `bash.deny` command checks + path-based read/write detection
//
// Bash parsing:
// - AST-based via shfmt when available (no false positives on quoted strings)
// - Falls back to string-based parsing when shfmt is not installed
//
// Confirmation behavior:
// - Matching `denyRead`, `denyWrite`, or blocked `allowWrite` rules triggers a confirmation dialog.
// - Bash violations offer three choices:
//   - Allow once (y/Enter)
//   - Allow for session (a) — skips future prompts for the same command pattern
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
//   - undefined -> unrestricted writes (except `denyWrite`)
//   - []        -> no paths auto-allowed; every write needs confirmation
//   - patterns  -> matching paths are auto-allowed; others need confirmation
// - `denyWrite` always wins over `allowWrite`.
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
// - Detects common file reads against `paths.denyRead`.
// - Detects common file writes against both `paths.allowWrite` and
//   `paths.denyWrite`.
//
// Session allow-list:
// - When user chooses "Allow for session" on a bash command, the command string
//   is remembered for the current session.
// - Future identical commands skip the confirmation prompt entirely.
// - The allow-list is cleared when the session ends.
//
// Config files (merged, project takes precedence):
// - ~/.pi/agent/guardrails.json
// - <effective cwd>/.pi/guardrails.json
//
// Example configs:
//
// 1) Typical project setup
// {
//   "timeout": 300000,
//   "paths": {
//     "denyRead": [
//       "**/.env",
//       "**/.env.*",
//       "~/.ssh/**",
//       "~/.aws/**"
//     ],
//     "allowWrite": [
//       "./**",
//       "/tmp/**"
//     ],
//     "denyWrite": [
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
//     "denyRead": ["**/.env", "~/.ssh/**"],
//     "allowWrite": [],
//     "denyWrite": ["**/*"]
//   },
//   "bash": {
//     "deny": ["rm", "sudo", "dd", "mkfs", "curl", "wget"]
//   }
// }
//
// Notes:
// - `allowWrite` omitted => unrestricted writes except paths in `denyWrite`
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
import { getConfigSourceInfo, loadConfig } from "./config.js";
import { getEffectiveCwd } from "./effective-cwd.js";
import { checkRead, checkWrite } from "./path-guard.js";
import { checkBash, isShfmtAvailable } from "./bash-guard.js";
import type { GuardrailsConfig, BashViolation } from "./types.js";
import { DEFAULT_TIMEOUT } from "./types.js";

function allowWriteLabel(config: GuardrailsConfig): string {
  const aw = config.paths?.allowWrite;
  if (aw === undefined) return "(unrestricted)";
  if (aw.length === 0) return "(confirmation required for all writes)";
  return aw.join(", ");
}

function configSourceLabel(cwd: string): string {
  const info = getConfigSourceInfo(cwd);
  const activeSources: string[] = [];

  if (info.hasGlobal) activeSources.push(info.globalPath);
  if (info.hasProject) activeSources.push(info.projectPath);

  return activeSources.length > 0 ? activeSources.join(" + ") : "defaults only";
}

function scopeLabel(cwd: string): string {
  const effectiveCwd = getEffectiveCwd(cwd);
  return effectiveCwd === cwd ? effectiveCwd : `${effectiveCwd} (git root)`;
}

// ─── Session allow-list ───

/**
 * Tracks bash commands allowed for the current session.
 * When a user chooses "Allow for session", the exact command string
 * is stored here and future identical commands skip confirmation.
 */
class SessionAllowList {
  private allowedCommands = new Set<string>();
  private allowedPatterns: string[] = [];

  /** Check if a command is allowed for this session */
  isAllowed(command: string): boolean {
    if (this.allowedCommands.has(command)) return true;
    // Check if any allowed pattern is a substring of the command
    for (const pattern of this.allowedPatterns) {
      if (command.includes(pattern)) return true;
    }
    return false;
  }

  /** Allow an exact command for this session */
  allowCommand(command: string): void {
    this.allowedCommands.add(command);
  }

  /** Allow a violation pattern for this session (e.g., a specific denied command name) */
  allowPattern(pattern: string): void {
    if (!this.allowedPatterns.includes(pattern)) {
      this.allowedPatterns.push(pattern);
    }
  }

  /** Clear all session allows */
  clear(): void {
    this.allowedCommands.clear();
    this.allowedPatterns = [];
  }

  /** Get count of allowed entries */
  get size(): number {
    return this.allowedCommands.size + this.allowedPatterns.length;
  }
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
  const violationLines = violations.map(v => {
    if (v.type === "denied_command") {
      return `  • Denied command: ${v.command}`;
    } else if (v.type === "file_read_detected") {
      return `  • File read detected: ${v.details}`;
    } else {
      return `  • File write detected: ${v.details}`;
    }
  }).join("\n");

  const truncatedCmd = truncate(command, 200);

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

          const lines: string[] = [
            warningLine,
            theme.fg("warning", theme.bold("  🛡️ Guardrails — Bash Confirmation")) + countdownText,
            warningLine,
            "",
            theme.fg("text", "  Command:"),
            theme.fg("dim", `    ${truncatedCmd}`),
            "",
            theme.fg("text", "  Violations:"),
            ...violationLines.split("\n").map(l => theme.fg("warning", l)),
            "",
            accentLine,
            `  ${theme.fg("accent", "y/Enter")} allow once  •  ${theme.fg("accent", "a")} allow for session  •  ${theme.fg("accent", "n/Esc")} deny`,
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

  return result;
}

export default function (pi: ExtensionAPI) {
  let config: GuardrailsConfig = { timeout: DEFAULT_TIMEOUT, paths: {}, bash: {} };
  const sessionAllow = new SessionAllowList();

  function refreshConfig(cwd: string, force = false): GuardrailsConfig {
    config = loadConfig(cwd, { force });
    return config;
  }

  // Load config on session start
  pi.on("session_start", async (_event, ctx) => {
    config = refreshConfig(ctx.cwd, true);
    sessionAllow.clear();

    const t = ctx.ui.theme;
    const astAvailable = isShfmtAvailable();
    const parserLabel = astAvailable ? "AST (shfmt)" : "string-based (fallback)";

    const header = t.fg("mdHeading", "[Guardrails]");
    const lines: string[] = [header];

    if (config.paths?.denyRead?.length) {
      lines.push(t.fg("dim", `  Deny Read:   ${config.paths.denyRead.join(", ")}`));
    }
    if (config.paths?.allowWrite !== undefined) {
      lines.push(t.fg("dim", `  Allow Write: ${allowWriteLabel(config)}`));
    }
    if (config.paths?.denyWrite?.length) {
      lines.push(t.fg("dim", `  Deny Write:  ${config.paths.denyWrite.join(", ")}`));
    }
    if (config.bash?.deny?.length) {
      lines.push(t.fg("dim", `  Bash Deny:   ${config.bash.deny.join(", ")}`));
    }
    lines.push(t.fg("dim", `  Scope:       ${scopeLabel(ctx.cwd)}`));
    lines.push(t.fg("dim", `  Config:      ${configSourceLabel(ctx.cwd)}`));
    lines.push(t.fg("dim", `  Parser:      ${parserLabel}`));

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

    // ─── Read Guard ───
    if (isToolCallEventType("read", event)) {
      const filePath = event.input.path;
      const result = checkRead(filePath, ctx.cwd, currentConfig, { patternCwd });

      if (!result.allowed && result.requiresConfirmation) {
        if (!ctx.hasUI) {
          return { block: true, reason: `[Guardrails] Read blocked (no UI): ${result.reason}` };
        }

        const confirmed = await ctx.ui.confirm(
          "🛡️ Guardrails — Read Confirmation",
          `Reading this file requires confirmation:\n\n  ${filePath}\n\nReason: ${result.reason}\n\nAllow this read?`,
          { timeout }
        );

        if (!confirmed) {
          return {
            block: true,
            reason: `[Guardrails] Read denied by user or timed out after ${Math.round(timeout / 1000)}s: ${result.reason}`,
          };
        }
      }
    }

    // ─── Write / Edit Guard ───
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const filePath = event.input.path;
      const result = checkWrite(filePath, ctx.cwd, currentConfig, { patternCwd });

      if (!result.allowed) {
        if (result.requiresConfirmation) {
          if (!ctx.hasUI) {
            return { block: true, reason: `[Guardrails] Write blocked (no UI): ${result.reason}` };
          }

          const confirmed = await ctx.ui.confirm(
            "🛡️ Guardrails — Write Confirmation",
            `Writing to this file requires confirmation:\n\n  ${filePath}\n\nReason: ${result.reason}\n\nAllow this write?`,
            { timeout }
          );

          if (!confirmed) {
            return {
              block: true,
              reason: `[Guardrails] Write denied by user or timed out after ${Math.round(timeout / 1000)}s: ${result.reason}`,
            };
          }
        } else {
          if (ctx.hasUI) {
            ctx.ui.notify(`🛡️ Write blocked: ${filePath}\n${result.reason}`, "warning");
          }
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

      // Check session allow-list first
      if (sessionAllow.isAllowed(command)) {
        return undefined;
      }

      const result = checkBash(command, ctx.cwd, currentConfig, { patternCwd });

      if (!result.allowed) {
        // Filter out violations for commands already allowed in session
        const activeViolations = result.violations.filter(v => {
          if (v.type === "denied_command") {
            return !sessionAllow.isAllowed(v.command);
          }
          return true;
        });

        if (activeViolations.length === 0) {
          return undefined;
        }

        if (!ctx.hasUI) {
          const reasons = activeViolations.map(v => `  • ${v.details ?? v.command}`).join("\n");
          return {
            block: true,
            reason: `[Guardrails] Bash blocked (no UI):\n${reasons}`,
          };
        }

        const confirmResult = await confirmBashViolation(command, activeViolations, ctx, timeout);

        if (confirmResult === "allow-session") {
          // Remember this command for the session
          sessionAllow.allowCommand(command);

          // Also allow the individual denied command names for flexibility
          for (const v of activeViolations) {
            if (v.type === "denied_command") {
              sessionAllow.allowPattern(v.command);
            }
          }

          ctx.ui.notify(
            `🛡️ Allowed for session${sessionAllow.size > 1 ? ` (${sessionAllow.size} rules)` : ""}`,
            "info",
          );
          return undefined;
        }

        if (confirmResult === "deny") {
          const violationLines = activeViolations.map(v => {
            if (v.type === "denied_command") return `  • Denied command: ${v.command}`;
            if (v.type === "file_read_detected") return `  • File read detected: ${v.details}`;
            return `  • File write detected: ${v.details}`;
          }).join("\n");

          return {
            block: true,
            reason: `[Guardrails] Bash denied by user or timed out after ${Math.round(timeout / 1000)}s:\n${violationLines}`,
          };
        }

        // "allow" — allow this one time, continue
        return undefined;
      }
    }

    return undefined;
  });

  // ─── /guardrails command ───
  pi.registerCommand("guardrails", {
    description: "Show current guardrails configuration",
    handler: async (_args, ctx) => {
      const cfg = refreshConfig(ctx.cwd, true);
      const astAvailable = isShfmtAvailable();
      const lines = [
        "🛡️ Guardrails Configuration",
        "",
        `Scope: ${scopeLabel(ctx.cwd)}`,
        `Config source: ${configSourceLabel(ctx.cwd)}`,
        `Timeout: ${(cfg.timeout ?? DEFAULT_TIMEOUT) / 1000}s`,
        `Bash parser: ${astAvailable ? "AST (shfmt)" : "string-based (fallback)"}`,
        `Session allows: ${sessionAllow.size}`,
        "",
        "─── Paths ───",
        `Deny Read:   ${cfg.paths?.denyRead?.length ? cfg.paths.denyRead.join(", ") : "(none)"}`,
        `Allow Write: ${allowWriteLabel(cfg)}`,
        `Deny Write:  ${cfg.paths?.denyWrite?.length ? cfg.paths.denyWrite.join(", ") : "(none)"}`,
        "",
        "─── Bash ───",
        `Deny:        ${cfg.bash?.deny?.length ? cfg.bash.deny.join(", ") : "(none)"}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}
