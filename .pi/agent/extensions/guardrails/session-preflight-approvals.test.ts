import { describe, expect, it } from "bun:test";
import { SessionPreflightApprovals } from "./session-preflight-approvals.js";

describe("SessionPreflightApprovals", () => {
  it("stores a sanitized command shape, intent, and risk signals by scope", () => {
    const approvals = new SessionPreflightApprovals();
    const approval = approvals.add({
      scope: "/repo-a",
      command: "curl -H 'Authorization: Bearer secret-value' https://example.test/deploy",
      intent: "  Deploy the current preview build. ",
      reason: "Expected preview deployment",
      riskSignals: ["network access", "repo mutation", "network access"],
      createdAt: "2026-07-21T00:00:00.000Z",
    });

    expect(approval).toEqual({
      scope: "/repo-a",
      command: "curl -H Authorization:<sensitive> <url>",
      intent: "Deploy the current preview build.",
      reason: "Expected preview deployment",
      riskSignals: ["network access", "repo mutation"],
      createdAt: "2026-07-21T00:00:00.000Z",
    });
    expect(approvals.approvalsForScope("/repo-b")).toEqual([]);
    expect(approvals.approvalsForScope("/repo-a")).toEqual([approval]);
  });

  it("deduplicates matching approvals and rejects missing intent", () => {
    const approvals = new SessionPreflightApprovals();
    const input = {
      scope: "/repo",
      command: "git push origin feature/login",
      intent: "Push a feature branch to origin",
      reason: "Expected delivery",
      riskSignals: ["network access", "repo mutation"],
      createdAt: "2026-07-21T00:00:00.000Z",
    };

    expect(approvals.add(input)).toBeDefined();
    expect(approvals.add(input)).toEqual(approvals.approvalsForScope("/repo")[0]);
    expect(approvals.size).toBe(1);
    expect(approvals.add({ ...input, command: "git push origin main", intent: "none" })).toBeUndefined();
  });
});
