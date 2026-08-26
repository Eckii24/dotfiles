import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type SessionStartEvent = { reason?: unknown };

type StartupStatusContext = Pick<ExtensionContext, "hasUI" | "mode" | "ui">;

type StartupStatus = {
  message: string;
  error: boolean;
};

type StartupStatusState = {
  statuses: Map<string, StartupStatus>;
  sessionKey: string | undefined;
};

const STATE_KEY = "__matthiaseckPiStartupStatus";

function getState(): StartupStatusState {
  const global = globalThis as typeof globalThis & Record<typeof STATE_KEY, StartupStatusState | undefined>;
  return global[STATE_KEY] ??= { statuses: new Map(), sessionKey: undefined };
}

function getSessionKey(event: SessionStartEvent): string {
  return typeof event.reason === "string" ? event.reason : "startup";
}

/** Keep startup status lines together; Pi coalesces consecutive info notifications. */
export function reportStartupStatus(
  event: SessionStartEvent,
  ctx: StartupStatusContext,
  key: string,
  message: string,
  options: { error?: boolean } = {},
): void {
  const state = getState();
  const currentSessionKey = getSessionKey(event);
  if (currentSessionKey !== state.sessionKey) {
    state.statuses.clear();
    state.sessionKey = currentSessionKey;
  }
  state.statuses.set(key, { message, error: options.error ?? false });
  if (!ctx.hasUI) return;

  const rendered = [...state.statuses.values()].map((status) =>
    ctx.mode === "tui" && status.error ? ctx.ui.theme.fg("error", status.message) : status.message
  );
  ctx.ui.notify(rendered.join("\n"), "info");
}
