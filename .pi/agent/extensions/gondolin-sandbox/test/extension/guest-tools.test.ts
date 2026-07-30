import assert from "node:assert/strict";
import test from "node:test";
import { BoundedTailAccumulator, executeGuestBash, executeGuestRead, executeGuestSearch } from "../../index.ts";

test("read executes and slices content entirely in the guest", async () => {
  const calls: any[] = [];
  const vm = { exec: async (args: string[], options?: any) => {
    calls.push({ args, options });
    return { ok: true, exitCode: 0, stdout: "3\ntwo\n", stderr: "", stdoutBuffer: Buffer.from("3\ntwo\n") };
  }};
  const result = await executeGuestRead(vm as never, "/workspace/a.txt", { offset: 2, limit: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ["/bin/bash", "-lc"]);
  assert.deepEqual(calls[0].args.slice(4, 7), ["/workspace/a.txt", "2", "2"]);
  assert.match(result.content[0].text, /^two/);
  assert.match(result.content[0].text, /more lines/);
});

test("read counts an unterminated final line and rejects only true beyond-end offsets", async () => {
  const vm = { exec: async () => ({ ok: true, exitCode: 0, stdout: "2\nb\n", stderr: "" }) };
  const result = await executeGuestRead(vm as never, "/workspace/a.txt", { offset: 2, limit: 1 });
  assert.equal(result.content[0].text, "b\n");
  await assert.rejects(() => executeGuestRead(vm as never, "/workspace/a.txt", { offset: 3, limit: 1 }), /beyond end.*2 lines total/);
});

test("bash streams in guest and truncates without a host fullOutputPath spill", async () => {
  const process: any = Promise.resolve({ exitCode: 0 });
  process.output = async function* () { yield { data: Buffer.from("ok\n") }; };
  const vm = { exec: (args: string[], options: any) => {
    assert.deepEqual(args.slice(0, 2), ["/bin/bash", "-lc"]);
    assert.match(args[2], /rewrite/);
    assert.equal(args[4], "/usr/local/bin/rtk");
    assert.equal(args[5], "pwd");
    assert.equal(options.cwd, "/workspace");
    return process;
  }};
  const updates: any[] = [];
  const result = await executeGuestBash(vm as never, "/workspace", { command: "pwd" }, undefined, (u) => updates.push(u));
  assert.equal(result.content[0].text, "ok\n");
  assert.equal(result.details?.fullOutputPath, undefined);
  assert.ok(updates.length > 0);
});

test("bash does not exec when caller signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const vm = { exec: () => { calls++; throw new Error("must not execute"); } };
  const result = await executeGuestBash(vm as never, "/workspace", { command: "pwd" }, controller.signal);
  assert.equal(calls, 0);
  assert.match(result.content[0].text, /Command cancelled/);
});

test("bash tail accumulator stays within hard byte and line caps for multi-megabyte chunks", () => {
  const tail = new BoundedTailAccumulator(50 * 1024, 2000);
  for (let i = 0; i < 32; i++) {
    tail.append(Buffer.alloc(256 * 1024, 97));
    tail.append(Buffer.from(`\nline-${i}\n`));
    assert.ok(tail.retainedBytes <= 50 * 1024);
    assert.ok(tail.retainedLines <= 2000);
  }
  assert.equal(tail.truncated, true);
  assert.match(tail.content, /line-31/);
});

test("guest search reports guest-enforced result and byte limits without buffering stdout", async () => {
  const calls: any[] = [];
  const vm = { exec: async (args: string[], options?: any) => {
    calls.push({ args, options });
    return { ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t2\t1\t1\na.ts:1: hit\nb.ts:2: hit\n", stderr: "" };
  }};
  const result = await executeGuestSearch(vm as never, ["/bin/bash", "-lc", "bounded", "test"], undefined, "empty", "results", 2);
  assert.match(result.content[0].text, /a\.ts:1/);
  assert.match(result.content[0].text, /2 results limit reached/);
  assert.match(result.content[0].text, /50KB limit reached/);
  assert.equal(calls[0].options.signal, undefined);
});

test("read asks the guest to bound an oversized file before it reaches host memory", async () => {
  const calls: any[] = [];
  const bounded = `5000\n${"x".repeat(50 * 1024)}\n`;
  const vm = { exec: async (args: string[], options?: any) => {
    calls.push({ args, options });
    return { ok: true, exitCode: 0, stdout: bounded, stderr: "", stdoutBuffer: Buffer.from(bounded) };
  }};
  const result = await executeGuestRead(vm as never, "/workspace/huge.txt", { offset: 100, limit: 5000 });
  assert.deepEqual(calls[0].args.slice(0, 2), ["/bin/bash", "-lc"]);
  assert.match(calls[0].args[2], /head|dd/);
  assert.match(calls[0].args[2], /tail/);
  assert.ok(Buffer.byteLength(result.content[0].text) <= 52 * 1024);
});