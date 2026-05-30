import { describe, expect, it } from "bun:test";
import { buildPreflightPrompt, parsePreflightVerdict } from "./preflight.js";

describe("parsePreflightVerdict", () => {
  it("parses structured allow verdicts", () => {
    const result = parsePreflightVerdict(`before\n[PREFLIGHT_VERDICT]\nDECISION: ALLOW\nREASON: harmless and contextually appropriate\nCONCERNS: none\n[/PREFLIGHT_VERDICT]\nafter`);

    expect(result).toEqual({
      decision: "allow",
      reason: "harmless and contextually appropriate",
      concerns: [],
    });
  });

  it("parses confirm verdicts with concerns", () => {
    const result = parsePreflightVerdict(`[PREFLIGHT_VERDICT]\nDECISION: CONFIRM\nREASON: network request may be valid but deserves user review\nCONCERNS: network access; remote destination unclear\n[/PREFLIGHT_VERDICT]`);

    expect(result).toEqual({
      decision: "confirm",
      reason: "network request may be valid but deserves user review",
      concerns: ["network access", "remote destination unclear"],
    });
  });
});

describe("buildPreflightPrompt", () => {
  it("includes command, context and deterministic hints", () => {
    const prompt = buildPreflightPrompt({
      command: "curl https://example.com",
      cwd: "/repo",
      effectiveCwd: "/repo",
      recentContext: "User asked to fetch API docs",
      gate1Reason: "Outside Gate 1 allowlist",
      gate1Hints: ["network access"],
    });

    expect(prompt).toContain("curl https://example.com");
    expect(prompt).toContain("User asked to fetch API docs");
    expect(prompt).toContain("network access");
    expect(prompt).toContain("DECISION: ALLOW|CONFIRM|DENY");
  });
});
