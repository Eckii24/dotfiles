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

  it("lists commands for the current scope", () => {
    const allow = new SessionAllowList();
    allow.allowCommand("/repo-a", "npm test -- --runInBand");
    allow.allowCommand("/repo-a", "npm test -- --watch=false");
    allow.allowCommand("/repo-b", "npm publish");

    expect(allow.commandsForScope("/repo-a")).toEqual([
      "npm test -- --runInBand",
      "npm test -- --watch=false",
    ]);
  });

  it("does not add duplicate exact commands", () => {
    const allow = new SessionAllowList();

    expect(allow.allowCommand("/repo-a", "npm test")).toBe(true);
    expect(allow.allowCommand("/repo-a", "npm test")).toBe(false);
    expect(allow.size).toBe(1);
  });

  it("scopes read and write approvals independently", () => {
    const allow = new SessionAllowList();
    allow.allowRead("/repo-a");
    allow.allowWrite("/repo-a");

    expect(allow.isReadAllowed("/repo-a")).toBe(true);
    expect(allow.isWriteAllowed("/repo-a")).toBe(true);
    expect(allow.isReadAllowed("/repo-b")).toBe(false);
    expect(allow.isWriteAllowed("/repo-b")).toBe(false);
    expect(allow.commandSize).toBe(0);
    expect(allow.readScopeSize).toBe(1);
    expect(allow.writeScopeSize).toBe(1);
  });

  it("clears command and path session approvals", () => {
    const allow = new SessionAllowList();
    allow.allowCommand("/repo-a", "pwd");
    allow.allowRead("/repo-a");
    allow.allowWrite("/repo-a");
    allow.clear();

    expect(allow.isAllowed("/repo-a", "pwd")).toBe(false);
    expect(allow.isReadAllowed("/repo-a")).toBe(false);
    expect(allow.isWriteAllowed("/repo-a")).toBe(false);
    expect(allow.size).toBe(0);
  });
});
