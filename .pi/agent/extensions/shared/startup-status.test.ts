import { describe, expect, test } from "bun:test";
import { reportStartupStatus } from "./startup-status.ts";

describe("startup status", () => {
  test("keeps extension states together in one startup message", () => {
    const notices: string[] = [];
    const ctx: any = {
      cwd: "/repo",
      hasUI: true,
      sessionManager: { getSessionFile: () => "/session.jsonl" },
      ui: { notify(message: string) { notices.push(message); } },
    };

    const event = { reason: "startup-status-test" };
    reportStartupStatus(event, ctx, "guardrails", "[guardrails] enabled=yes");
    reportStartupStatus(event, ctx, "quality-gate", "[quality-gate] Quality gate: disabled");
    reportStartupStatus(event, ctx, "sandbox", "[sandbox] inactive");

    expect(notices.at(-1)).toBe([
      "[guardrails] enabled=yes",
      "[quality-gate] Quality gate: disabled",
      "[sandbox] inactive",
    ].join("\n"));
  });
});
