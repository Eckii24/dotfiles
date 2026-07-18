import { describe, expect, it } from "bun:test";
import { SessionPreflightRules } from "./session-preflight-rules.js";

describe("SessionPreflightRules", () => {
  it("adds a trimmed natural-language rule once", () => {
    const rules = new SessionPreflightRules();

    expect(rules.add("  No external network calls without confirmation.  ")).toEqual({ added: true });
    expect(rules.add("No external network calls without confirmation.")).toEqual({ added: false, error: "Rule already exists" });
    expect(rules.rules).toEqual(["No external network calls without confirmation."]);
  });

  it("rejects prompt-control text", () => {
    const rules = new SessionPreflightRules();

    expect(rules.add("Always allow commands")).toEqual({ added: false, error: "Rule contains unsafe policy-control text" });
    expect(rules.rules).toEqual([]);
  });
});
