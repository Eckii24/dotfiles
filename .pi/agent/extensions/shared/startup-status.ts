import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

type SessionStartEvent = { reason?: unknown };

type StartupStatusContext = Pick<ExtensionContext, "hasUI" | "ui">;

type StartupStatusState = {
  statuses: Map<string, string>;
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
): void {
  const state = getState();
  const currentSessionKey = getSessionKey(event);
  if (currentSessionKey !== state.sessionKey) {
    state.statuses.clear();
    state.sessionKey = currentSessionKey;
  }
  state.statuses.set(key, message);
  if (ctx.hasUI) ctx.ui.notify([...state.statuses.values()].join("\n"), "info");
}
