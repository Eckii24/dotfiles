import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import test from "node:test";
import { BoundedTailAccumulator, executeGuestBash, executeGuestRead, executeGuestSearch, GUEST_FIND, GUEST_GREP } from "../../index.ts";

const execFile = promisify(execFileCallback);
async function guestScript(script: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFile("/bin/bash", ["-lc", script, "guest-test", ...args], { cwd, maxBuffer: 128 * 1024 });
}

test("read executes and slices content entirely in the guest", async () => {
  const calls: any[] = [];
  const vm = { exec: async (args: string[], options?: any) => {
    calls.push({ args, options });
    return { ok: true, exitCode: 0, stdout: "3\ntwo\n", stderr: "", stdoutBuffer: Buffer.from("3\ntwo\n") };
  }};
  const result = await executeGuestRead(vm as never, "/workspace/a.txt", { offset: 2, limit: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ["/bin/bash", "-lc"]);
  assert.deepEqual(calls[0].args.slice(4, 7), ["/workspace/a.txt", "2", "1"]);
  assert.match(result.content[0].text, /^two/);
  assert.match(result.content[0].text, /more lines/);
});

test("read counts an unterminated final line and rejects only true beyond-end offsets", async () => {
  const vm = { exec: async () => ({ ok: true, exitCode: 0, stdout: "2\nb\n", stderr: "" }) };
  const result = await executeGuestRead(vm as never, "/workspace/a.txt", { offset: 2, limit: 1 });
  assert.equal(result.content[0].text, "b\n");
  await assert.rejects(() => executeGuestRead(vm as never, "/workspace/a.txt", { offset: 3, limit: 1 }), /beyond end.*2 lines total/);
});

test("guest read script exactly preserves Pi split slices, including trailing empty lines", async () => {
  const root = await mkdtemp(`${tmpdir()}/gondolin-read-`);
  try {
    const run = async (content: string, offset: number, limit: number) => {
      const file = `${root}/input`;
      await writeFile(file, content);
      const vm = { exec: async (args: string[]) => {
        const result = await guestScript(args[2], args.slice(4), root);
        return { ok: true, exitCode: 0, ...result };
      }};
      return (await executeGuestRead(vm as never, file, { offset, limit })).content[0].text;
    };
    assert.equal(await run("", 1, 1), "");
    assert.equal(await run("a", 1, 99), "a");
    assert.equal(await run("a\n", 1, 99), "a\n");
    assert.equal(await run("a\nb", 1, 99), "a\nb");
    assert.equal(await run("a\nb\n", 1, 99), "a\nb\n");
    assert.equal(await run("a\nb\n", 3, 1), "");
    assert.match(await run("a\nb\n", 1, 0), /3 more lines/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("guest grep uses NUL filenames, preserves contexts, and bounds output/errors", async () => {
  const root = await mkdtemp(`${tmpdir()}/gondolin-grep-`);
  try {
    const regular = `${root}/single.txt`;
    await writeFile(regular, "needle\nafter\n");
    await writeFile(`${root}/name:colon.txt`, "needle:12:content\n");
    await writeFile(`${root}/long.txt`, `${"needle ".repeat(200)}\n`);
    const grep = (target: string, pattern = "needle", limit = "20", context = "0") =>
      guestScript(GUEST_GREP.replaceAll("/usr/bin/rg", "rg"), [target, pattern, limit, "51200", "0", "0", context, ""], root);
    const single = await grep(regular);
    assert.match(single.stdout, /single\.txt:1:needle/);
    assert.doesNotMatch(single.stdout, /:1: needle/);
    const colon = await grep(root);
    assert.match(colon.stdout, /name:colon\.txt:1:needle:12:content/);
    const context = await grep(regular, "needle", "1", "1");
    assert.match(context.stdout, /single\.txt:1:needle/);
    assert.match(context.stdout, /single\.txt-2-after/);
    const long = await grep(`${root}/long.txt`);
    assert.match(long.stdout, /\.\.\./);
    await assert.rejects(() => grep(root, "[", "20"), (error: any) => {
      assert.ok(Buffer.byteLength(error.stderr ?? "") <= 51200);
      assert.ok(Buffer.byteLength(error.stdout ?? "") <= 51200);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("guest grep/find scripts preserve bounded behavior and Pi recursive globs", async () => {
  const root = await mkdtemp(`${tmpdir()}/gondolin-guest-tools-`);
  try {
    await writeFile(`${root}/a.ts`, "hit\ncontext\n");
    await writeFile(`${root}/a.spec.ts`, "hit\n");
    await writeFile(`${root}/long.ts`, `${"hit ".repeat(200)}\n`);
    await writeFile(`${root}/ignored.ts`, "hit\n");
    await execFile("git", ["init", "-q"], { cwd: root });
    await writeFile(`${root}/.gitignore`, "ignored.ts\n");
    await writeFile(`${root}/src-a.spec.ts`, "hit\n");
    await writeFile(`${root}/src/a.spec.ts`, "hit\n").catch(async () => { await execFile("mkdir", ["-p", `${root}/src`]); await writeFile(`${root}/src/a.spec.ts`, "hit\n"); });
    const found = await guestScript(GUEST_FIND, [root, "**/*.ts", "20", "51200"], root);
    assert.match(found.stdout, /a\.ts/);
    assert.match(found.stdout, /src\/a\.spec\.ts/);
    assert.doesNotMatch(found.stdout, /ignored\.ts/);
    const nested = await guestScript(GUEST_FIND, [root, "src/**/*.spec.ts", "20", "51200"], root);
    assert.match(nested.stdout, /src\/a\.spec\.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test("guest search validates bounded stdout and stderr", async () => {
  const oversized = "x".repeat(50 * 1024 + 1);
  for (const result of [
    { ok: false, exitCode: 2, stdout: oversized, stderr: "bad" },
    { ok: false, exitCode: 2, stdout: "", stderr: oversized },
  ]) {
    const vm = { exec: async () => result };
    await assert.rejects(() => executeGuestSearch(vm as never, [], undefined, "empty", "results", 1), /output exceeded limit/);
  }
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
  assert.equal(calls[0].options.stdout, undefined);
  assert.equal(calls[0].options.stderr, undefined);
});

test("guest search preserves trailing spaces on matched lines instead of trimming them", async () => {
  const vm = { exec: async () => ({ ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t1\t0\t0\na.ts:1:hit   \n", stderr: "" }) };
  const result = await executeGuestSearch(vm as never, [], undefined, "empty", "results", 10);
  assert.equal(result.content[0].text, "a.ts:1:hit   ");
});

test("guest search reports the byte-limit notice instead of the empty sentinel when the body is empty", async () => {
  const vm = { exec: async () => ({ ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t0\t0\t1\n", stderr: "" }) };
  const result = await executeGuestSearch(vm as never, [], undefined, "empty", "results", 10);
  assert.equal(result.content[0].text, "[50KB limit reached. Refine search]");
  assert.equal(result.details?.truncation?.truncated, true);
});

test("guest search still returns the empty sentinel when body and limits are both absent", async () => {
  const vm = { exec: async () => ({ ok: true, exitCode: 0, stdout: "__GONDOLIN_SEARCH_META__\t0\t0\t0\n", stderr: "" }) };
  const result = await executeGuestSearch(vm as never, [], undefined, "empty", "results", 10);
  assert.equal(result.content[0].text, "empty");
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
  assert.match(calls[0].args[2], /awk/);
  assert.ok(Buffer.byteLength(result.content[0].text) <= 52 * 1024);
});