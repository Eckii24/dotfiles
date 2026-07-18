import { describe, expect, it } from "bun:test";
import { evaluateBashCommandGates } from "./command-gates.js";

const baseConfig = {
  timeout: 300000,
  paths: {
    denyRead: ["**/.env"],
  },
  bash: {},
};

describe("evaluateBashCommandGates", () => {
  it("gate 1 allowlists a single simple read-only command via AST", () => {
    const result = evaluateBashCommandGates("pwd", process.cwd(), baseConfig);

    expect(result.gate).toBe(1);
    expect(result.decision).toBe("allow");
    expect(result.requiresPreflight).toBe(false);
  });

  it("does not gate-1 allowlist chained commands even when each command is harmless", () => {
    const result = evaluateBashCommandGates("pwd && ls", process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.requiresPreflight).toBe(true);
    expect(result.hints).toContain("multiple commands");
  });

  it("gate 1 allowlists safe HTTP GET/HEAD requests", () => {
    const curl = evaluateBashCommandGates("curl -fsSL https://example.com/docs/install", process.cwd(), baseConfig);
    const wget = evaluateBashCommandGates("wget --spider https://example.com/docs/install", process.cwd(), baseConfig);

    expect(curl.gate).toBe(1);
    expect(curl.decision).toBe("allow");
    expect(curl.requiresPreflight).toBe(false);
    expect(wget.gate).toBe(1);
    expect(wget.decision).toBe("allow");
    expect(wget.requiresPreflight).toBe(false);
  });

  it("keeps curl requests with possible exfiltration in gate 2", () => {
    const result = evaluateBashCommandGates("curl 'https://example.com/api?token=abc123'", process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.hints).toContain("network access");
  });

  it("passes deterministic risk hints for write redirections into gate 2", () => {
    const result = evaluateBashCommandGates("echo hi > out.txt", process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.hints).toContain("write redirection");
  });

  it("gate 1 allowlists standalone test commands", () => {
    const result = evaluateBashCommandGates("bun test", process.cwd(), baseConfig);

    expect(result.gate).toBe(1);
    expect(result.decision).toBe("allow");
  });

  it("does not Gate-1 allow embedded execution or write-capable forms of otherwise safe commands", () => {
    for (const command of [
      "find . -exec rm -rf {} +",
      "sort -o output.txt input.txt",
      "grep -R token .",
    ]) {
      const result = evaluateBashCommandGates(command, process.cwd(), baseConfig);
      expect(result.gate).toBe(2);
      expect(result.requiresPreflight).toBe(true);
    }
  });

  it("uses configured gate-1 allow commands only when executed standalone", () => {
    const result = evaluateBashCommandGates("node --version", process.cwd(), {
      ...baseConfig,
      bash: { allow: ["node"] },
    });

    expect(result.gate).toBe(1);
    expect(result.decision).toBe("allow");
  });

  it("preserves gate-1 allowlist behavior in fallback mode", () => {
    const result = evaluateBashCommandGates("pwd", process.cwd(), baseConfig, { forceFallback: true });

    expect(result.gate).toBe(1);
    expect(result.decision).toBe("allow");
    expect(result.requiresPreflight).toBe(false);
  });

  it("keeps chained allowlisted commands in gate 2 in fallback mode", () => {
    const result = evaluateBashCommandGates("pwd && ls", process.cwd(), baseConfig, { forceFallback: true });

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.requiresPreflight).toBe(true);
  });

  it("does not treat quoted shell metacharacters as fallback-mode control syntax", () => {
    const bracketRegex = evaluateBashCommandGates('grep "[0-9]" foo.txt', process.cwd(), baseConfig, { forceFallback: true });
    const pipeRegex = evaluateBashCommandGates('grep "foo|bar" foo.txt', process.cwd(), baseConfig, { forceFallback: true });

    expect(bracketRegex.gate).toBe(1);
    expect(pipeRegex.gate).toBe(1);
  });

  it("rejects command substitution in fallback-mode gate 1 even when quoted", () => {
    const result = evaluateBashCommandGates('grep "$(whoami)" foo.txt', process.cwd(), baseConfig, { forceFallback: true });

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
  });

  it("keeps backgrounded commands in gate 2 in fallback mode", () => {
    const result = evaluateBashCommandGates("pwd & curl https://example.com", process.cwd(), baseConfig, { forceFallback: true });

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.requiresPreflight).toBe(true);
  });

  it("keeps backgrounded commands in gate 2 in AST mode", () => {
    const result = evaluateBashCommandGates("pwd &", process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
    expect(result.requiresPreflight).toBe(true);
  });

  it("keeps mutating git branch forms in gate 2", () => {
    const result = evaluateBashCommandGates("git branch -D demo", process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
  });

  it("keeps parameter-expanded paths in gate 2", () => {
    const result = evaluateBashCommandGates('cat "$HOME/docs/readme.txt"', process.cwd(), baseConfig);

    expect(result.gate).toBe(2);
    expect(result.decision).toBe("preflight");
  });

  it("applies deterministic safe command definitions in fallback mode", () => {
    const safeGet = evaluateBashCommandGates("curl -fsSL https://example.com/docs/install", process.cwd(), baseConfig, { forceFallback: true });
    const test = evaluateBashCommandGates("npm test -- --runInBand", process.cwd(), baseConfig, { forceFallback: true });
    const readOnly = evaluateBashCommandGates("rg login src", process.cwd(), baseConfig, { forceFallback: true });

    expect(safeGet.gate).toBe(1);
    expect(test.gate).toBe(1);
    expect(readOnly.gate).toBe(1);
  });
});
