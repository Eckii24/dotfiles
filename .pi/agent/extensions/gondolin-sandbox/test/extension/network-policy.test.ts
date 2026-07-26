import assert from "node:assert/strict";
import test from "node:test";
import { NETWORK_ALLOWED_HOSTS } from "../../index.ts";

test("Phase-0 network policy uses an explicit empty host allowlist", () => {
  assert.deepEqual(NETWORK_ALLOWED_HOSTS, []);
});
