import { describe, expect, it } from "bun:test";
import { checkBash } from "./bash-guard.js";

const baseConfig = {
  timeout: 300000,
  paths: {},
  bash: {
    deny: ["echo"],
  },
};

describe("checkBash parsing", () => {
  it("finds denied commands nested in find, command, and env wrappers", () => {
    const config = {
      timeout: 300000,
      paths: {},
      bash: { deny: ["rm"] },
    };

    for (const command of [
      "find . -exec rm -rf {} +",
      "command rm -rf /tmp/demo",
      "env MODE=test rm -rf /tmp/demo",
    ]) {
      const result = checkBash(command, process.cwd(), config);
      expect(result.allowed).toBe(false);
      expect(result.violations.some((violation) => violation.command === "rm")).toBe(true);
    }
  });

  it("checks commands after standalone background separators", () => {
    const result = checkBash("pwd & echo hi", process.cwd(), baseConfig, { forceFallback: true });

    expect(result.allowed).toBe(false);
    expect(result.violations).toEqual([
      {
        type: "denied_command",
        command: "echo",
        segment: "echo hi",
        details: "Command 'echo' is in the deny list",
      },
    ]);
  });

  it("does not split fd redirections as background separators", () => {
    const result = checkBash("echo hi 2>&1", process.cwd(), baseConfig, { forceFallback: true });

    expect(result.allowed).toBe(false);
    expect(result.violations[0]?.command).toBe("echo");
    expect(result.violations[0]?.segment).toBe("echo hi 2>&1");
  });

  it("does not propagate backgrounded cd into later path checks", () => {
    const config = {
      timeout: 300000,
      paths: {
        allowWrite: ["./sandbox/**"],
      },
      bash: {},
    };

    for (const forceFallback of [false, true]) {
      const result = checkBash("cd sandbox & echo hi > allowed.txt", "/tmp/repo", config, {
        patternCwd: "/tmp/repo",
        forceFallback,
      });

      expect(result.allowed).toBe(false);
      expect(result.violations[0]?.details).toContain("Path not in allowWrite list");
    }
  });

  it("does not propagate subshell cd into outer path checks", () => {
    const config = {
      timeout: 300000,
      paths: {
        allowWrite: ["./sandbox/**"],
      },
      bash: {},
    };

    for (const forceFallback of [false, true]) {
      const result = checkBash("(cd sandbox; echo hi > allowed.txt) & echo ok > denied.txt", "/tmp/repo", config, {
        patternCwd: "/tmp/repo",
        forceFallback,
      });

      expect(result.allowed).toBe(false);
      expect(result.violations.some((violation) => violation.details?.includes("Path not in allowWrite list"))).toBe(true);
    }
  });

  it("does not propagate command-substitution cd into outer path checks", () => {
    const config = {
      timeout: 300000,
      paths: {
        allowWrite: ["./sandbox/**"],
      },
      bash: {},
    };

    const result = checkBash("echo $(cd sandbox; printf x); echo ok > allowed.txt", "/tmp/repo", config, {
      patternCwd: "/tmp/repo",
    });

    expect(result.allowed).toBe(false);
    expect(result.violations.some((violation) => violation.details?.includes("Path not in allowWrite list"))).toBe(true);
  });

  it("treats >& file redirects as writes but ignores fd duplication", () => {
    const config = {
      timeout: 300000,
      paths: {
        allowWrite: ["./sandbox/**"],
      },
      bash: {},
    };

    const fileRedirect = checkBash("echo x >& denied.txt", "/tmp/repo", config, {
      patternCwd: "/tmp/repo",
    });
    const fdDuplication = checkBash("echo x 2>&1", "/tmp/repo", config, {
      patternCwd: "/tmp/repo",
    });
    const dynamicTarget = checkBash("echo x >& \"$DEST\"", "/tmp/repo", config, {
      patternCwd: "/tmp/repo",
    });
    const fdClose = checkBash("echo x >&-", "/tmp/repo", config, {
      patternCwd: "/tmp/repo",
    });

    expect(fileRedirect.allowed).toBe(false);
    expect(fileRedirect.violations[0]?.details).toContain("Path not in allowWrite list");
    expect(fdDuplication.allowed).toBe(true);
    expect(dynamicTarget.allowed).toBe(false);
    expect(dynamicTarget.violations[0]?.details).toContain("Path not in allowWrite list");
    expect(fdClose.allowed).toBe(true);
  });
});
