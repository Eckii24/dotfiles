import { describe, expect, it } from "bun:test";
import { SessionAllowList } from "./session-allow-list.js";

describe("SessionAllowList", () => {
  it("allows exact commands only", () => {
    const allow = new SessionAllowList();
    allow.allowCommand("/repo-a", "sudo ls /tmp");

    expect(allow.isAllowed("/repo-a", "sudo ls /tmp")).toBe(true);
    expect(allow.isAllowed("/repo-a", "sudo rm -rf /tmp/foo")).toBe(false);
  });

  it("scopes approvals by cwd context", () => {
    const allow = new SessionAllowList();
    allow.allowCommand("/repo-a", "cat .env");

    expect(allow.isAllowed("/repo-a", "cat .env")).toBe(true);
    expect(allow.isAllowed("/repo-b", "cat .env")).toBe(false);
  });

  it("clears session approvals", () => {
    const allow = new SessionAllowList();
    allow.allowCommand("/repo-a", "pwd");
    allow.clear();

    expect(allow.isAllowed("/repo-a", "pwd")).toBe(false);
    expect(allow.size).toBe(0);
  });
});
