import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreflightPrompt, parsePreflightVerdict, runPreflightJudge } from "./preflight.js";

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

describe("runPreflightJudge", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("closes stdin and invokes pi with isolated fast-mode flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guardrails-preflight-test-"));
    tempDirs.push(dir);
    const argsPath = join(dir, "args.txt");
    const fakePi = join(dir, "pi");

    writeFileSync(fakePi, `#!/bin/sh
printf '%s\n' "$@" > "$PI_GUARDRAILS_ARGS_FILE"
cat >/dev/null
cat <<'OUT'
[PREFLIGHT_VERDICT]
DECISION: ALLOW
REASON: fake safe verdict
CONCERNS: none
[/PREFLIGHT_VERDICT]
OUT
`);
    chmodSync(fakePi, 0o755);

    const previousArgsFile = process.env.PI_GUARDRAILS_ARGS_FILE;
    process.env.PI_GUARDRAILS_ARGS_FILE = argsPath;
    try {
      const result = await runPreflightJudge({
        cwd: dir,
        model: "github-copilot/claude-haiku-4.5",
        prompt: "judge this",
        timeoutMs: 500,
        piExecutable: fakePi,
      });

      expect(result).toEqual({
        decision: "allow",
        reason: "fake safe verdict",
        concerns: [],
      });

      const args = readFileSync(argsPath, "utf-8").trim().split("\n");
      expect(args).toContain("-p");
      expect(args).toContain("judge this");
      expect(args).toContain("--model");
      expect(args).toContain("github-copilot/claude-haiku-4.5");
      expect(args).toContain("--no-session");
      expect(args).toContain("--no-tools");
      expect(args).toContain("--no-extensions");
      expect(args).toContain("--no-skills");
      expect(args).toContain("--no-prompt-templates");
      expect(args).toContain("--no-context-files");
      expect(args).toContain("--no-themes");
      expect(args).toContain("--thinking");
      expect(args).toContain("off");
      expect(args).not.toContain("--thinking-level");
    } finally {
      if (previousArgsFile === undefined) {
        delete process.env.PI_GUARDRAILS_ARGS_FILE;
      } else {
        process.env.PI_GUARDRAILS_ARGS_FILE = previousArgsFile;
      }
    }
  });
});
