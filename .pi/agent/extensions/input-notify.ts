// Input Notification Extension
//
// Sends macOS notifications and marks the tmux window whenever Pi needs
// user input — after the agent finishes, when the questionnaire tool
// fires, or when guardrails (or any other extension) emits the
// "notify:input-needed" event on the shared event bus.
//
// macOS:  osascript display notification with sound "Glass"
// tmux:   prepends 🔔 to the originating Pi window name (via TMUX_PANE)
//
// Reset:  on agent_start / input / session_shutdown
//
// Commands:
//   /notify        — show status
//   /notify test   — trigger a test notification

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { exec, execSync } from "node:child_process";

const MIN_AGENT_DURATION_MS = 3000;
const TMUX_MARK_PREFIX = "🔔 ";
const TMUX_ORIGINAL_NAME_OPTION = "@pi_input_notify_original_name";
const TMUX_AUTO_RENAME_OPTION = "@pi_input_notify_auto_rename";

export default function (pi: ExtensionAPI) {
  // ─── State ───────────────────────────────────────────────────────────
  let notified = false;
  let agentStartTime: number | null = null;
  let sourceWindowId: string | null = null;
  let originalWindowName: string | null = null;
  let autoRenameWasOn: boolean | null = null;
  let markedWindowId: string | null = null;
  const isTmux = !!process.env.TMUX;
  const tmuxPaneId = process.env.TMUX_PANE ?? null;

  // ─── macOS Notification ──────────────────────────────────────────────

  function sendMacOSNotification(message: string, title = "Pi") {
    try {
      const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const titleEscaped = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      exec(
        `osascript -e 'display notification "${escaped}" with title "${titleEscaped}" sound name "Glass"'`,
        { timeout: 5000 },
        () => {}, // fire-and-forget, ignore errors
      );
    } catch {
      // Fail silently
    }
  }

  // ─── tmux Helpers ────────────────────────────────────────────────────

  function tmuxExec(cmd: string): string | null {
    if (!isTmux) return null;
    try {
      return execSync(cmd, { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch {
      return null;
    }
  }

  function shSingleQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  function stripTmuxMarkPrefix(name: string): string {
    return name.startsWith(TMUX_MARK_PREFIX) ? name.slice(TMUX_MARK_PREFIX.length) : name;
  }

  function getWindowName(windowId: string): string | null {
    return tmuxExec(
      `tmux display-message -p -t ${shSingleQuote(windowId)} '#{window_name}'`,
    );
  }

  function getWindowOption(windowId: string, option: string): string | null {
    return tmuxExec(
      `tmux show-window-option -t ${shSingleQuote(windowId)} -v ${option} 2>/dev/null`,
    );
  }

  function setWindowOption(windowId: string, option: string, value: string) {
    tmuxExec(
      `tmux set-window-option -t ${shSingleQuote(windowId)} ${option} ${shSingleQuote(value)} 2>/dev/null`,
    );
  }

  function unsetWindowOption(windowId: string, option: string) {
    tmuxExec(
      `tmux set-window-option -u -t ${shSingleQuote(windowId)} ${option} 2>/dev/null`,
    );
  }

  function resolveSourceWindowId(): string | null {
    if (!isTmux) return null;

    if (tmuxPaneId) {
      const paneWindowId = tmuxExec(
        `tmux display-message -p -t ${shSingleQuote(tmuxPaneId)} '#{window_id}'`,
      );
      if (paneWindowId) return paneWindowId;
    }

    return tmuxExec("tmux display-message -p '#{window_id}'");
  }

  function getSourceWindowId(): string | null {
    if (sourceWindowId !== null) return sourceWindowId;
    sourceWindowId = resolveSourceWindowId();
    return sourceWindowId;
  }

  function adoptExistingTmuxMark() {
    if (!isTmux || originalWindowName !== null) return;

    try {
      const windowId = getSourceWindowId();
      if (windowId === null) return;

      const currentName = getWindowName(windowId);
      if (currentName === null) return;

      const savedOriginalName = getWindowOption(windowId, TMUX_ORIGINAL_NAME_OPTION);
      const savedAutoRename = getWindowOption(windowId, TMUX_AUTO_RENAME_OPTION);
      const isMarked = currentName.startsWith(TMUX_MARK_PREFIX);

      if (!isMarked) {
        if (savedOriginalName !== null || savedAutoRename !== null) {
          unsetWindowOption(windowId, TMUX_ORIGINAL_NAME_OPTION);
          unsetWindowOption(windowId, TMUX_AUTO_RENAME_OPTION);
        }
        return;
      }

      // Backward compatibility: if an older version marked the window without
      // persisting tmux metadata, recover the original name by stripping the prefix.
      originalWindowName = savedOriginalName ?? stripTmuxMarkPrefix(currentName);
      autoRenameWasOn = savedAutoRename === "on" ? true : savedAutoRename === "off" ? false : null;
      markedWindowId = windowId;
      notified = true;

      if (savedOriginalName === null) {
        setWindowOption(windowId, TMUX_ORIGINAL_NAME_OPTION, originalWindowName);
      }
    } catch {
      // Fail silently
    }
  }

  function markTmuxWindow() {
    if (!isTmux || originalWindowName !== null) return; // already marked

    try {
      const windowId = getSourceWindowId();
      if (windowId === null) return;

      const name = getWindowName(windowId);
      if (name === null) return;

      const savedOriginalName = getWindowOption(windowId, TMUX_ORIGINAL_NAME_OPTION);
      const savedAutoRename = getWindowOption(windowId, TMUX_AUTO_RENAME_OPTION);
      const autoRename = getWindowOption(windowId, "automatic-rename");
      const isMarked = name.startsWith(TMUX_MARK_PREFIX);

      originalWindowName = savedOriginalName ?? stripTmuxMarkPrefix(name);
      autoRenameWasOn = savedAutoRename === "on" ? true : savedAutoRename === "off" ? false : autoRename === "on";
      markedWindowId = windowId;

      setWindowOption(windowId, TMUX_ORIGINAL_NAME_OPTION, originalWindowName);
      setWindowOption(windowId, TMUX_AUTO_RENAME_OPTION, autoRenameWasOn ? "on" : "off");

      if (!isMarked) {
        tmuxExec(`tmux set-window-option -t ${shSingleQuote(windowId)} automatic-rename off 2>/dev/null`);
        tmuxExec(`tmux rename-window -t ${shSingleQuote(windowId)} ${shSingleQuote(`${TMUX_MARK_PREFIX}${originalWindowName}`)}`);
      }
    } catch {
      // Fail silently
    }
  }

  function resetTmuxWindow() {
    if (!isTmux || originalWindowName === null || markedWindowId === null) return;

    try {
      tmuxExec(`tmux rename-window -t ${shSingleQuote(markedWindowId)} ${shSingleQuote(originalWindowName)}`);
      if (autoRenameWasOn) {
        tmuxExec(`tmux set-window-option -t ${shSingleQuote(markedWindowId)} automatic-rename on 2>/dev/null`);
      }
      unsetWindowOption(markedWindowId, TMUX_ORIGINAL_NAME_OPTION);
      unsetWindowOption(markedWindowId, TMUX_AUTO_RENAME_OPTION);
    } catch {
      // Fail silently
    } finally {
      originalWindowName = null;
      autoRenameWasOn = null;
      markedWindowId = null;
    }
  }

  sourceWindowId = resolveSourceWindowId();
  adoptExistingTmuxMark();

  // ─── Core ────────────────────────────────────────────────────────────

  function triggerNotification(message: string) {
    if (notified) return; // debounce
    notified = true;
    sendMacOSNotification(message);
    markTmuxWindow();
  }

  function resetNotification() {
    if (!notified) return;
    notified = false;
    resetTmuxWindow();
  }

  // ─── Events ──────────────────────────────────────────────────────────

  // Track when the agent starts so we can skip fast responses
  pi.on("agent_start", async () => {
    agentStartTime = Date.now();
    resetNotification();
  });

  // Agent finished → waiting for next prompt
  pi.on("agent_end", async () => {
    if (agentStartTime !== null) {
      const duration = Date.now() - agentStartTime;
      if (duration < MIN_AGENT_DURATION_MS) return; // skip fast responses
    }
    triggerNotification("Agent finished — waiting for your input");
  });

  // Questionnaire tool started → will show a dialog
  pi.on("tool_execution_start", async (event) => {
    if (event.toolName === "questionnaire") {
      triggerNotification("Questionnaire — your input is needed");
    }
  });

  // Generic event bus integration — any extension can trigger a notification:
  //   pi.events.emit("notify:input-needed", { message: "..." })
  pi.events.on("notify:input-needed", (data?: { message?: string }) => {
    triggerNotification(data?.message || "Your input is needed");
  });

  // Reset on user input
  pi.on("input", async () => {
    resetNotification();
  });

  // Clean up on shutdown
  pi.on("session_shutdown", async () => {
    resetTmuxWindow();
    notified = false;
  });

  // ─── /notify command ─────────────────────────────────────────────────

  pi.registerCommand("notify", {
    description: "Show notification status or trigger a test notification",
    handler: async (args, ctx) => {
      const trimmed = (args || "").trim().toLowerCase();

      if (trimmed === "test") {
        // Force a test notification regardless of debounce state
        const wasNotified = notified;
        notified = false;
        triggerNotification("Test notification from Pi");
        ctx.ui.notify("✅ Test notification sent", "info");
        if (!wasNotified) {
          // Reset after a short delay so the test doesn't stick
          setTimeout(() => resetNotification(), 3000);
        }
        return;
      }

      // Show status
      const t = ctx.ui.theme;
      const lines = [
        t.fg("mdHeading", "[Input Notify]"),
        t.fg("dim", `  macOS:            osascript + sound "Glass"`),
        t.fg("dim", `  tmux detected:    ${isTmux ? "yes" : "no"}`),
        t.fg("dim", `  tmux source pane: ${tmuxPaneId ?? "(unknown)"}`),
        t.fg("dim", `  notified:         ${notified ? "yes (waiting for reset)" : "no"}`),
        t.fg("dim", `  min agent time:   ${MIN_AGENT_DURATION_MS / 1000}s`),
        "",
        t.fg("dim", `  Triggers:         agent_end (≥${MIN_AGENT_DURATION_MS / 1000}s), questionnaire, event bus`),
        t.fg("dim", `  Reset on:         agent_start, input, shutdown`),
        "",
        t.fg("dim", `  Use ${t.fg("accent", "/notify test")} to send a test notification`),
      ];

      if (isTmux) {
        lines.splice(3, 0,
          t.fg("dim", `  tmux target:      ${markedWindowId ?? getSourceWindowId() ?? "(unresolved)"}`),
          t.fg("dim", `  tmux window:      ${originalWindowName !== null ? `${TMUX_MARK_PREFIX}${originalWindowName}` : "(not marked)"}`),
        );
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
