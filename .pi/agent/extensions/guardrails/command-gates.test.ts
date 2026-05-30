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

  it("passes deterministic risk hints for network commands into gate 2", () => {
    const result = evaluateBashCommandGates("curl https://example.com", process.cwd(), baseConfig);

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

  it("uses configured gate-1 allow commands only when executed standalone", () => {
    const result = evaluateBashCommandGates("bun test", process.cwd(), {
      ...baseConfig,
      bash: { allow: ["bun"] },
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
});
