import { describe, expect, test } from "bun:test";
import { reportStartupStatus } from "./startup-status.ts";

describe("startup status", () => {
  test("keeps extension states together in one startup message", () => {
    const notices: string[] = [];
    const ctx: any = {
      cwd: "/repo",
      hasUI: true,
      mode: "tui",
      sessionManager: { getSessionFile: () => "/session.jsonl" },
      ui: {
        notify(message: string) { notices.push(message); },
        theme: { fg(color: string, message: string) { return `<${color}>${message}</${color}>`; } },
      },
    };

    const event = { reason: "startup-status-test" };
    reportStartupStatus(event, ctx, "guardrails", "[guardrails] enabled=yes");
    reportStartupStatus(event, ctx, "quality-gate", "[quality-gate] Quality gate: disabled", { error: true });
    reportStartupStatus(event, ctx, "sandbox", "[sandbox] inactive");

    expect(notices.at(-1)).toBe([
      "[guardrails] enabled=yes",
      "<error>[quality-gate] Quality gate: disabled</error>",
      "[sandbox] inactive",
    ].join("\n"));
  });
});
