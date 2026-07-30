import { describe, expect, it } from "bun:test";

import { checkRead, checkWrite } from "./path-guard.js";

describe("path confirmation kinds", () => {
  const cwd = "/repo";

  it("identifies confirmRead approvals", () => {
    const result = checkRead(".env", cwd, {
      paths: { confirmRead: ["**/.env"] },
    });

    expect(result.allowed).toBe(false);
    expect(result.confirmationKind).toBe("confirm-read");
  });

  it("identifies allowWrite misses separately from confirmWrite", () => {
    const allowWriteMiss = checkWrite("src/new.ts", cwd, {
      paths: { allowWrite: ["generated/**"] },
    });
    const confirmWriteMatch = checkWrite(".env", cwd, {
      paths: { allowWrite: ["**"], confirmWrite: ["**/.env"] },
    });

    expect(allowWriteMiss.confirmationKind).toBe("allow-write");
    expect(confirmWriteMatch.confirmationKind).toBe("confirm-write");
  });
});
