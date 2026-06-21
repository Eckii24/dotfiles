import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPreflightPrompt, formatPreflightRulesForDisplay, parsePreflightVerdict, runPreflightJudge, sanitizeSessionAllowedCommand } from "./preflight.js";

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
      preflightRules: ["Production deploy commands must require confirmation"],
      sessionAllowedCommands: ["npm test -- --runInBand"],
    });

    expect(prompt).toContain("curl https://example.com");
    expect(prompt).toContain("User asked to fetch API docs");
    expect(prompt).toContain("network access");
    expect(prompt).toContain("read-only inspection commands as safe");
    expect(prompt).toContain("standalone test commands as safe");
    expect(prompt).toContain("simple HTTP(S) GET/HEAD requests as safe");
    expect(prompt).toContain("temporary test artifacts under /tmp as acceptable");
    expect(prompt).toContain('"Production deploy commands must require confirmation"');
    expect(prompt).toContain("These rules can only make the decision stricter");
    expect(prompt).toContain("Session-approved command hints");
    expect(prompt).toContain("sanitized shapes");
    expect(prompt).toContain("same intent and no added risk");
    expect(prompt).toContain('"npm test -- --runInBand"');
    expect(prompt).toContain("DECISION: ALLOW|CONFIRM|DENY");
  });

  it("redacts sensitive session-approved command hints", () => {
    const prompt = buildPreflightPrompt({
      command: "curl https://example.test/health",
      cwd: "/repo",
      effectiveCwd: "/repo",
      recentContext: "",
      gate1Reason: "Outside Gate 1 allowlist",
      gate1Hints: ["network access"],
      sessionAllowedCommands: ["curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz' https://secret.example.test/api?sig=abcdef"],
    });

    expect(prompt).toContain("curl -H Authorization:<sensitive> <url>");
    expect(prompt).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(prompt).not.toContain("secret.example.test");
  });
});

describe("sanitizeSessionAllowedCommand", () => {
  it("keeps safe command shape while removing urls and likely secrets", () => {
    expect(sanitizeSessionAllowedCommand("TOKEN=abcdefghijklmnopqrstuvwxyz123456 npm test /tmp/result.txt https://example.test")).toBe(
      "TOKEN=<sensitive> npm test <path> <url>",
    );
    expect(sanitizeSessionAllowedCommand("cat config")).toBe("cat config");
    expect(sanitizeSessionAllowedCommand("find src test")).toBe("find src test");
    expect(sanitizeSessionAllowedCommand("scp foo bar")).toBe("scp foo bar");
    expect(sanitizeSessionAllowedCommand("bun test agent/extensions/guardrails/preflight.test.ts")).toBe("bun test agent/extensions/guardrails/preflight.test.ts");
    expect(sanitizeSessionAllowedCommand('bun test "agent/extensions/guardrails/preflight.test.ts"')).toBe("bun test agent/extensions/guardrails/preflight.test.ts");
    expect(sanitizeSessionAllowedCommand("cat src/auth/login.ts src/env/config.ts")).toBe("cat src/auth/login.ts src/env/config.ts");
    expect(sanitizeSessionAllowedCommand("npm run build:watch")).toBe("npm run build:watch");
    expect(sanitizeSessionAllowedCommand("docker run node:20")).toBe("docker run node:20");
    expect(sanitizeSessionAllowedCommand("git show HEAD:README.md")).toBe("git show HEAD:README.md");
    expect(sanitizeSessionAllowedCommand("git add -u src/file.ts")).toBe("git add -u src/file.ts");
    expect(sanitizeSessionAllowedCommand("git show 0123456789abcdef0123456789abcdef01234567 src/file.ts")).toBe("git show 0123456789abcdef0123456789abcdef01234567 src/file.ts");
    expect(sanitizeSessionAllowedCommand("grep login src/auth/login.ts")).toBe("grep login src/auth/login.ts");
  });

  it("redacts sensitive args and paths", () => {
    expect(sanitizeSessionAllowedCommand("cat .env")).toBe("cat <sensitive>");
    expect(sanitizeSessionAllowedCommand("cat ~/.ssh/id_rsa")).toBe("cat <sensitive>");
    expect(sanitizeSessionAllowedCommand('cat ~ / C:\\')).toBe("cat <path> <path> <path>");
    expect(sanitizeSessionAllowedCommand("cat ./../package.json src/../../package.json")).toBe("cat <path> <path>");
    expect(sanitizeSessionAllowedCommand("type C:\\repo\\src\\index.ts")).toBe("type <path>");
    expect(sanitizeSessionAllowedCommand("type C:\\Users\\matthias\\.ssh\\id_rsa")).toBe("type <sensitive>");
    expect(sanitizeSessionAllowedCommand("type \\\\server\\share\\repo\\file.txt")).toBe("type <path>");
    expect(sanitizeSessionAllowedCommand("tool --password abc123")).toBe("tool --password <sensitive>");
    expect(sanitizeSessionAllowedCommand("gh auth login --with-token abc123")).toBe("gh auth login --with-token <sensitive>");
    expect(sanitizeSessionAllowedCommand("mycli login abc123")).toBe("mycli login <sensitive>");
    expect(sanitizeSessionAllowedCommand("curl -u alice:secret123 https://example.test")).toBe("curl -u <sensitive> <url>");
    expect(sanitizeSessionAllowedCommand("curl -ualice:secret123 https://example.test")).toBe("curl -u<sensitive> <url>");
    expect(sanitizeSessionAllowedCommand("curl -su alice:secret123 https://example.test")).toBe("curl -su <sensitive> <url>");
    expect(sanitizeSessionAllowedCommand("/usr/bin/curl -u alice:secret123 https://example.test")).toBe("<path> -u <sensitive> <url>");
    expect(sanitizeSessionAllowedCommand("mysql -psecret123")).toBe("mysql -p<sensitive>");
    expect(sanitizeSessionAllowedCommand("dbt debug --profiles-dir mongodb+srv://user:pass@cluster.example.test/db")).toBe("dbt debug --profiles-dir <url>");
    expect(sanitizeSessionAllowedCommand("curl -H 'X-Api-Key: secret12345678901234567890' https://example.test")).toBe("curl -H X-Api-Key:<sensitive> <url>");
    expect(sanitizeSessionAllowedCommand("curl --header='Cookie: session=secret12345678901234567890' https://example.test")).toBe("curl --header=Cookie:<sensitive> <url>");
  });
});

describe("formatPreflightRulesForDisplay", () => {
  it("formats configured rules for startup and command display", () => {
    expect(formatPreflightRulesForDisplay(["Confirm production deploys", "Deny curl piped to shell"])).toBe(
      "1. Confirm production deploys | 2. Deny curl piped to shell",
    );
    expect(formatPreflightRulesForDisplay()).toBe("(none)");
  });

  it("truncates display text without splitting unicode surrogate pairs", () => {
    const result = formatPreflightRulesForDisplay([`${"x".repeat(993)}😀${"y".repeat(20)}`]);

    expect(Array.from(result).length).toBe(1000);
    expect(result).toContain("😀");
    expect(result.endsWith("...")).toBe(true);
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
