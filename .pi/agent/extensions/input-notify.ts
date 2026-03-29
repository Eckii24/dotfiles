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
// Reset:  on agent_start / input / questionnaire end / resolved event /
//         tmux focus return / session_shutdown
//
// Commands:
//   /notify        — show status
//   /notify test   — trigger a test notification

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { exec, execSync } from "node:child_process";

const TMUX_FOCUS_POLL_MS = 1000;
const TMUX_MARK_PREFIX = "🔔 ";
const TMUX_ORIGINAL_NAME_OPTION = "@pi_input_notify_original_name";
const TMUX_AUTO_RENAME_OPTION = "@pi_input_notify_auto_rename";
const NOTIFY_INPUT_NEEDED_EVENT = "notify:input-needed";
const NOTIFY_INPUT_RESOLVED_EVENT = "notify:input-resolved";
const SUBAGENT_ENV = "PI_SUBAGENT";

export default function (pi: ExtensionAPI) {
  // ─── State ───────────────────────────────────────────────────────────
  let notified = false;
  let sourceWindowId: string | null = null;
  let originalWindowName: string | null = null;
  let autoRenameWasOn: boolean | null = null;
  let markedWindowId: string | null = null;
  let tmuxFocusWatcher: ReturnType<typeof setInterval> | null = null;
  let tmuxTargetWasAway = false;
  const isTmux = !!process.env.TMUX;
  const tmuxPaneId = process.env.TMUX_PANE ?? null;
  const isSubagent = process.env[SUBAGENT_ENV] === "1";

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

  function getPaneTitle(paneId: string): string | null {
    return tmuxExec(
      `tmux display-message -p -t ${shSingleQuote(paneId)} '#{pane_title}'`,
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

  function getSourcePaneTitle(): string | null {
    if (!tmuxPaneId) return null;
    return getPaneTitle(tmuxPaneId);
  }

  function getTmuxNotificationContext(): string | null {
    if (!isTmux) return null;

    const windowName = originalWindowName ?? (() => {
      const windowId = markedWindowId ?? getSourceWindowId();
      return windowId ? getWindowName(windowId) : null;
    })();

    // Assumption: tmux pane titles are the closest practical equivalent to a
    // human-visible “pane name”, because tmux panes do not have a separate
    // stable user-facing name field.
    const paneTitle = getSourcePaneTitle();

    const parts = [windowName, paneTitle]
      .map((part) => part?.trim())
      .filter((part): part is string => !!part);

    return parts.length > 0 ? `tmux: ${parts.join(" / ")}` : null;
  }

  function withTmuxNotificationContext(message: string): string {
    const tmuxContext = getTmuxNotificationContext();
    return tmuxContext ? `${message} — ${tmuxContext}` : message;
  }

  function isTmuxTargetFocused(): boolean | null {
    if (!isTmux) return null;

    try {
      // Assumption: attached tmux clients expose their currently selected
      // window/pane via list-clients. Pi does not receive explicit tmux focus
      // events, so we resolve the mark when the originating tmux target becomes
      // selected again after being away.
      const targetWindowId = markedWindowId ?? getSourceWindowId();
      if (targetWindowId === null) return null;

      const output = tmuxExec("tmux list-clients -F '#{session_attached}\t#{window_id}\t#{pane_id}' 2>/dev/null");
      if (output === null) return null;
      if (output.length === 0) return false;

      return output
        .split(/\r?\n/)
        .filter(Boolean)
        .some((line) => {
          const [sessionAttached, windowId, paneId] = line.split("\t");
          if (sessionAttached !== "1") return false;
          if (tmuxPaneId) return paneId === tmuxPaneId;
          return windowId === targetWindowId;
        });
    } catch {
      return null;
    }
  }

  function stopTmuxFocusWatcher() {
    if (tmuxFocusWatcher !== null) {
      clearInterval(tmuxFocusWatcher);
      tmuxFocusWatcher = null;
    }
    tmuxTargetWasAway = false;
  }

  function startTmuxFocusWatcher() {
    if (!isTmux) return;

    stopTmuxFocusWatcher();
    tmuxTargetWasAway = isTmuxTargetFocused() === false;

    tmuxFocusWatcher = setInterval(() => {
      const focused = isTmuxTargetFocused();
      if (focused === null) return;

      if (!focused) {
        tmuxTargetWasAway = true;
        return;
      }

      if (tmuxTargetWasAway) {
        resetNotification();
      }
    }, TMUX_FOCUS_POLL_MS);
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
  if (notified) {
    startTmuxFocusWatcher();
  }

  // ─── Core ────────────────────────────────────────────────────────────

  function triggerNotification(message: string) {
    if (notified) return; // debounce
    notified = true;
    sendMacOSNotification(withTmuxNotificationContext(message));
    markTmuxWindow();
    startTmuxFocusWatcher();
  }

  function resetNotification() {
    stopTmuxFocusWatcher();
    if (!notified) return;
    notified = false;
    resetTmuxWindow();
  }

  // ─── Events ──────────────────────────────────────────────────────────

  // Reset any previous indication when a new agent turn begins
  pi.on("agent_start", async () => {
    resetNotification();
  });

  // Agent finished → waiting for next prompt
  pi.on("agent_end", async () => {
    if (isSubagent) return;
    triggerNotification("Agent finished — waiting for your input");
  });

  // Questionnaire tool started → will show a dialog
  pi.on("tool_execution_start", async (event) => {
    if (event.toolName === "questionnaire") {
      triggerNotification("Questionnaire — your input is needed");
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.toolName === "questionnaire") {
      resetNotification();
    }
  });

  // Generic event bus integration — any extension can trigger a notification:
  //   pi.events.emit("notify:input-needed", { message: "..." })
  pi.events.on(NOTIFY_INPUT_NEEDED_EVENT, (data?: { message?: string }) => {
    triggerNotification(data?.message || "Your input is needed");
  });

  pi.events.on(NOTIFY_INPUT_RESOLVED_EVENT, () => {
    resetNotification();
  });

  // Reset on user input
  pi.on("input", async () => {
    resetNotification();
  });

  // Clean up on shutdown
  pi.on("session_shutdown", async () => {
    stopTmuxFocusWatcher();
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
        t.fg("dim", `  tmux pane title:  ${getSourcePaneTitle() ?? "(unknown)"}`),
        t.fg("dim", `  tmux subagent:    ${isSubagent ? "yes (agent_end ignored)" : "no"}`),
        t.fg("dim", `  notified:         ${notified ? "yes (waiting for reset)" : "no"}`),
        t.fg("dim", `  tmux auto-resolve:${isTmux ? ` poll ${TMUX_FOCUS_POLL_MS}ms on focus return` : " n/a"}`),
        "",
        t.fg("dim", `  Triggers:         agent_end, questionnaire, event bus`),
        t.fg("dim", `  Reset on:         agent_start, input, shutdown, resolved event, tmux focus return`),
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
