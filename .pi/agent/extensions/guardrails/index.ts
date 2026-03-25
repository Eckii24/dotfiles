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
// Confirmation behavior:
// - Matching `denyRead` or `denyWrite` rules triggers a confirmation dialog.
// - If no confirmation is given before timeout, the operation is blocked.
// - Default timeout is 300000 ms (5 minutes), configurable via `timeout`.
//
// Path behavior:
// - Matches Pi path semantics: strips leading `@`, expands `~`, resolves
//   relative paths against `ctx.cwd`.
// - Checks both lexical and canonical (realpath) paths to prevent symlink
//   bypasses.
// - `allowWrite` semantics:
//   - undefined -> unrestricted writes (except `denyWrite`)
//   - []        -> deny all writes
//   - patterns  -> only matching paths writable
// - `denyWrite` always wins over `allowWrite`.
//
// Bash behavior:
// - Parses multi-command bash strings and checks each command individually.
// - Handles common separators and nesting forms, including:
//   - `&&`, `||`, `;`, pipes, newlines
//   - subshells: `(cmd1; cmd2)`
//   - command substitution: `$(...)`, backticks
//   - wrappers: `bash -c`, `sh -c`, `eval`, `sudo`, `exec`, `xargs`
//   - prefixes: `time`, `nice`, `timeout`, `env`, etc.
// - Tracks simple `cd dir && ...` changes so relative file targets are checked
//   against the effective shell cwd.
// - Detects common file reads (`cat`, `head`, `tail`, `grep`, etc.) against
//   `paths.denyRead`.
// - Detects common file writes (redirections, `cp`, `mv`, `tee`, `dd`, etc.)
//   against both `paths.allowWrite` and `paths.denyWrite`.
//
// Config files (merged, project takes precedence):
// - ~/.pi/agent/guardrails.json
// - <cwd>/.pi/guardrails.json
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
// - `allowWrite: []`   => deny all writes
// - project config overrides global config field-by-field
//
// Commands:
// - /guardrails -> shows the effective merged configuration for the current cwd
//
// Important limitations:
// - Bash analysis is best-effort and intentionally conservative.
// - Variable expansion, aliases, shell functions, heredocs, and all bash edge
//   cases cannot be modeled perfectly by string parsing.
// - For hard isolation, combine this extension with OS-level sandboxing.
//
// Note:
// - This header intentionally uses line comments instead of a block comment.
//   Glob patterns like `**/.env` or `**/*` contain `*/`, which would terminate
//   a `/* ... */` comment early and break TypeScript parsing.


import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { loadConfig } from "./config.js";
import { checkRead, checkWrite } from "./path-guard.js";
import { checkBash } from "./bash-guard.js";
import type { GuardrailsConfig } from "./types.js";
import { DEFAULT_TIMEOUT } from "./types.js";

function allowWriteLabel(config: GuardrailsConfig): string {
  const aw = config.paths?.allowWrite;
  if (aw === undefined) return "(unrestricted)";
  if (aw.length === 0) return "(deny all)";
  return aw.join(", ");
}

export default function (pi: ExtensionAPI) {
  let config: GuardrailsConfig = { timeout: DEFAULT_TIMEOUT, paths: {}, bash: {} };

  // Load config on session start
  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);

    const rules: string[] = [];
    if (config.paths?.denyRead?.length) rules.push(`denyRead: ${config.paths.denyRead.length} patterns`);
    if (config.paths?.allowWrite !== undefined) {
      rules.push(`allowWrite: ${config.paths.allowWrite.length === 0 ? "deny all" : `${config.paths.allowWrite.length} patterns`}`);
    }
    if (config.paths?.denyWrite?.length) rules.push(`denyWrite: ${config.paths.denyWrite.length} patterns`);
    if (config.bash?.deny?.length) rules.push(`bash deny: ${config.bash.deny.length} commands`);

    if (rules.length > 0) {
      ctx.ui.setStatus(
        "guardrails",
        ctx.ui.theme.fg("accent", `🛡️ Guardrails: ${rules.join(", ")}`)
      );
      ctx.ui.notify(`Guardrails loaded: ${rules.join(", ")}`, "info");
    } else {
      ctx.ui.setStatus("guardrails", ctx.ui.theme.fg("dim", "🛡️ Guardrails: no rules"));
    }
  });

  // Main tool_call interceptor
  pi.on("tool_call", async (event, ctx) => {
    const timeout = config.timeout ?? DEFAULT_TIMEOUT;

    // ─── Read Guard ───
    if (isToolCallEventType("read", event)) {
      const filePath = event.input.path;
      const result = checkRead(filePath, ctx.cwd, config);

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
      const result = checkWrite(filePath, ctx.cwd, config);

      if (!result.allowed) {
        if (result.requiresConfirmation) {
          // denyWrite match — ask for confirmation
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
          // Not in allowWrite — block outright
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
      const result = checkBash(command, ctx.cwd, config);

      if (!result.allowed) {
        if (!ctx.hasUI) {
          const reasons = result.violations.map(v => `  • ${v.details ?? v.command}`).join("\n");
          return {
            block: true,
            reason: `[Guardrails] Bash blocked (no UI):\n${reasons}`,
          };
        }

        const violationLines = result.violations.map(v => {
          if (v.type === "denied_command") {
            return `  • Denied command: ${v.command}`;
          } else if (v.type === "file_read_detected") {
            return `  • File read detected: ${v.details}`;
          } else {
            return `  • File write detected: ${v.details}`;
          }
        }).join("\n");

        const confirmed = await ctx.ui.confirm(
          "🛡️ Guardrails — Bash Confirmation",
          `This bash command requires confirmation:\n\n  ${truncate(command, 200)}\n\nViolations:\n${violationLines}\n\nAllow this command?`,
          { timeout }
        );

        if (!confirmed) {
          return {
            block: true,
            reason: `[Guardrails] Bash denied by user or timed out after ${Math.round(timeout / 1000)}s:\n${violationLines}`,
          };
        }
      }
    }

    return undefined;
  });

  // ─── /guardrails command ───
  pi.registerCommand("guardrails", {
    description: "Show current guardrails configuration",
    handler: async (_args, ctx) => {
      const cfg = loadConfig(ctx.cwd);
      const lines = [
        "🛡️ Guardrails Configuration",
        "",
        `Timeout: ${(cfg.timeout ?? DEFAULT_TIMEOUT) / 1000}s`,
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
