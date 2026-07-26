import assert from "node:assert/strict";
import test from "node:test";
import { isSandboxRequested } from "../../core.ts";
import { isOneShotMode } from "../../index.ts";

test("sandbox is dormant without flag or propagation marker", () => {
  assert.equal(isSandboxRequested(undefined, {}), false);
});

test("sandbox activates from explicit CLI flag", () => {
  assert.equal(isSandboxRequested(true, {}), true);
});

test("sandbox activates from the exact Gondolin propagation marker", () => {
  assert.equal(isSandboxRequested(false, { PI_SANDBOX: "gondolin" }), true);
  assert.equal(isSandboxRequested(false, { PI_SANDBOX: "other" }), false);
});

test("only print and JSON modes are one-shot; no-session TUI remains persistent", () => {
  assert.equal(isOneShotMode(["pi", "--print"]), true);
  assert.equal(isOneShotMode(["pi", "-p"]), true);
  assert.equal(isOneShotMode(["pi", "--mode", "json"]), true);
  assert.equal(isOneShotMode(["pi", "--mode=json"]), true);
  assert.equal(isOneShotMode(["pi", "--no-session"]), false);
});
