import assert from "node:assert/strict";
import test from "node:test";
import { SandboxRuntime } from "../../core.ts";

test("runtime startup is singleflight across concurrent callers", async () => {
  let creates = 0;
  let starts = 0;
  const vm = { id: "vm-12345678", start: async () => { starts += 1; } };
  const runtime = new SandboxRuntime(async () => {
    creates += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return vm;
  });

  const [first, second] = await Promise.all([runtime.ensureStarted(), runtime.ensureStarted()]);
  assert.equal(first, vm);
  assert.equal(second, vm);
  assert.equal(creates, 1);
  assert.equal(starts, 1);
});

test("failed startup remains fail-closed and is never retried", async () => {
  let creates = 0;
  const startupError = new Error("qemu unavailable");
  const runtime = new SandboxRuntime(async () => {
    creates += 1;
    throw startupError;
  });

  await assert.rejects(runtime.ensureStarted(), startupError);
  await assert.rejects(runtime.ensureStarted(), startupError);
  assert.equal(creates, 1);
  assert.equal(runtime.state, "failed");
});
