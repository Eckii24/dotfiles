import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "./config.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "guardrails-config-test-"));
}

describe("loadConfig", () => {
  it("accepts bash.allow and bash.preflightModel from project settings", () => {
    const cwd = makeTempDir();
    const piDir = join(cwd, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      guardrails: {
        bash: {
          allow: ["pwd", "ls"],
          preflightModel: "github-copilot/claude-haiku-4.5",
        },
      },
    }));

    const config = loadConfig(cwd, { force: true });

    expect(config.bash?.allow).toEqual(["pwd", "ls"]);
    expect(config.bash?.preflightModel).toBe("github-copilot/claude-haiku-4.5");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("ignores invalid bash.allow values", () => {
    const baselineCwd = makeTempDir();
    const baseline = loadConfig(baselineCwd, { force: true });

    const cwd = makeTempDir();
    const piDir = join(cwd, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      guardrails: {
        bash: {
          allow: ["pwd", 42],
        },
      },
    }));

    const config = loadConfig(cwd, { force: true });

    expect(config.bash?.allow).toEqual(baseline.bash?.allow);

    rmSync(baselineCwd, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("ignores invalid bash.preflightModel values", () => {
    const baselineCwd = makeTempDir();
    const baseline = loadConfig(baselineCwd, { force: true });

    const cwd = makeTempDir();
    const piDir = join(cwd, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      guardrails: {
        bash: {
          preflightModel: 123,
        },
      },
    }));

    const config = loadConfig(cwd, { force: true });

    expect(config.bash?.preflightModel).toEqual(baseline.bash?.preflightModel);

    rmSync(baselineCwd, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });
});
