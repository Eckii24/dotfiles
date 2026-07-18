import { expect, test } from "bun:test";
import { accessSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
	PI_HERDR_AGENT_PROFILE,
	PI_HERDR_GROUP,
	PI_HERDR_LEAF_RUN_ID,
	PI_HERDR_NESTING_DEPTH,
	PI_HERDR_PARENT_ROOT_RUN_ID,
	PI_HERDR_ROOT_RUN_ID,
	PI_HERDR_SUBAGENT_CHILD,
	createPiLaunchDescriptor,
} from "./pi-launch.js";

function fixtureRoot() {
	const root = mkdtempSync(join(tmpdir(), "pi-herdr-launch-"));
	const cwd = join(root, "workspace"); const runtime = join(root, "runtime");
	mkdirSync(cwd); mkdirSync(runtime);
	return { root, cwd, runtime };
}
function input(cwd: string, extra: Record<string, unknown> = {}) {
	return {
		piExecutable: process.execPath, cwd, rootRunId: "root-123", leafRunId: "leaf-456789", nestingDepth: 0, group: "safe group",
		profile: { name: "orchestrator", model: "openai-codex/gpt-test", tools: ["subagent", "subagent_control"], systemPrompt: "PRIVATE PROFILE BODY\nDo not leak." },
		...extra,
	};
}

test("builds persisted interactive argv with exact model and tools, never task or prompt body", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime, env: { SECRET: "must-not-inherit" } });
		expect(launch.executable).toBe(process.execPath);
		expect(launch.cwd).toBe(value.cwd);
		expect(launch.argv).toEqual(["--name", launch.name, "--model", "openai-codex/gpt-test", "--tools", "subagent,subagent_control", "--append-system-prompt", launch.promptFilePath]);
		expect(launch.argv).not.toContain("--mode");
		expect(launch.argv).not.toContain("rpc");
		expect(launch.argv).not.toContain("--print");
		expect(launch.argv).not.toContain("--no-session");
		expect(JSON.stringify(launch.argv)).not.toContain("PRIVATE PROFILE BODY");
		expect(JSON.stringify(launch.log)).not.toContain("PRIVATE PROFILE BODY");
		expect(JSON.stringify(launch)).not.toContain("PRIVATE PROFILE BODY");
		const envNames = [
			PI_HERDR_AGENT_PROFILE, PI_HERDR_GROUP, PI_HERDR_LEAF_RUN_ID, PI_HERDR_NESTING_DEPTH,
			PI_HERDR_PARENT_ROOT_RUN_ID, PI_HERDR_ROOT_RUN_ID, PI_HERDR_SUBAGENT_CHILD,
		].sort();
		expect(launch.log).toEqual({ executable: process.execPath, argv: launch.argv, cwd: value.cwd, envNames, name: launch.name });
		expect(launch.log.envNames).not.toContain("PRIVATE PROFILE BODY");
		expect(launch.env).toEqual({
		[PI_HERDR_ROOT_RUN_ID]: "root-123", [PI_HERDR_LEAF_RUN_ID]: "leaf-456789", [PI_HERDR_NESTING_DEPTH]: "1",
		[PI_HERDR_GROUP]: "safe group", [PI_HERDR_AGENT_PROFILE]: "orchestrator", [PI_HERDR_PARENT_ROOT_RUN_ID]: "root-123", [PI_HERDR_SUBAGENT_CHILD]: "1",
	});
		expect(launch.env).not.toHaveProperty("SECRET");
		expect(readFileSync(launch.promptFilePath, "utf8")).toBe("PRIVATE PROFILE BODY\nDo not leak.");
		await launch.cleanupAfterReady();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("worker/scout-like profiles receive no nested tools, and cwd is canonicalized", async () => {
	const value = fixtureRoot();
	try {
		const alias = join(value.root, "workspace-link"); symlinkSync(value.cwd, alias);
		const launch = await createPiLaunchDescriptor(input(alias, { profile: { name: "reader", tools: ["read"], systemPrompt: "body" } }), { runtimeRoot: value.runtime });
		expect(launch.cwd).toBe(value.cwd);
		expect(launch.argv).toEqual(["--name", launch.name, "--tools", "read", "--append-system-prompt", launch.promptFilePath]);
		expect(launch.argv.join(" ")).not.toContain("herdr_subagent");
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("uses 0700 current-user runtime directory, random 0600 prompt, and idempotent delayed cleanup", async () => {
	const value = fixtureRoot();
	try {
		const one = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime });
		const two = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime });
		expect(one.promptFilePath).not.toBe(two.promptFilePath);
		expect(lstatSync(dirname(one.promptFilePath)).mode & 0o777).toBe(0o700);
		expect(lstatSync(one.promptFilePath).mode & 0o777).toBe(0o600);
		accessSync(one.promptFilePath, constants.R_OK);
		expect(Bun.file(one.promptFilePath).size).toBeGreaterThan(0);
		await one.cleanupAfterReady();
		expect(Bun.file(one.promptFilePath).size).toBe(0);
		await one.cleanupAfterFailure();
		expect(Bun.file(two.promptFilePath).size).toBeGreaterThan(0);
		await two.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("increments nesting and sets launched root as direct parent, then rejects max depth or non-executable paths", async () => {
	const value = fixtureRoot();
	try {
		const nested = await createPiLaunchDescriptor(input(value.cwd, { nestingDepth: 2, parentRootRunId: "grandparent-root" }), { runtimeRoot: value.runtime });
		expect(nested.env).toMatchObject({ [PI_HERDR_NESTING_DEPTH]: "3", [PI_HERDR_PARENT_ROOT_RUN_ID]: "root-123" });
		await nested.cleanupAfterFailure();
		await expect(createPiLaunchDescriptor(input(value.cwd, { nestingDepth: 3 }), { runtimeRoot: value.runtime })).rejects.toMatchObject({ code: "nesting_depth_exceeded" });
		await expect(createPiLaunchDescriptor(input(value.cwd, { piExecutable: "pi" }), { runtimeRoot: value.runtime })).rejects.toMatchObject({ code: "pi_integration_missing" });
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});
