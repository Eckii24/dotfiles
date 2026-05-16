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
});
