import assert from "node:assert/strict";
import test from "node:test";
import { isGondolinSandboxRequested } from "./sandbox-intent.ts";

test("activates only for the exact sandbox flag or exact propagated marker", () => {
  assert.equal(isGondolinSandboxRequested(["pi"], {}), false);
  assert.equal(isGondolinSandboxRequested(["pi", "--sandbox"], {}), true);
  assert.equal(isGondolinSandboxRequested(["pi", "--sandbox=false"], {}), false);
  assert.equal(isGondolinSandboxRequested(["pi"], { PI_SANDBOX: "gondolin" }), true);
  assert.equal(isGondolinSandboxRequested(["pi"], { PI_SANDBOX: "anything-else" }), false);
});
