import { expect, test } from "bun:test";
import { accessSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PI_GUARDRAILS_DISABLED, PI_GUARDRAILS_PREFLIGHT_DISABLED, PI_GUARDRAILS_PREFLIGHT_RULES } from "../shared/guardrails-session-state.ts";
import { PI_QUALITY_GATE_ATTEMPTS, PI_QUALITY_GATE_DISABLED, PI_QUALITY_GATE_TASK } from "../shared/quality-gate-session-state.ts";
import {
	PI_HERDR_AGENT_PROFILE,
	PI_HERDR_ALLOWED_CHILDREN,
	PI_HERDR_GROUP,
	PI_HERDR_LEAF_RUN_ID,
	PI_HERDR_NESTING_DEPTH,
	PI_HERDR_PARENT_ROOT_RUN_ID,
	PI_HERDR_ROOT_RUN_ID,
	PI_HERDR_SUBAGENT_CHILD,
	PI_SANDBOX,
	PI_SANDBOX_SESSION_POLICY,
	MAX_SANDBOX_SESSION_POLICY_BYTES,
	PI_SUBAGENT,
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
		profile: { name: "nested-runtime-fixture", model: "openai-codex/gpt-test", thinking: "high", tools: ["subagent", "subagent_control"], allowedChildren: ["scout"], systemPrompt: "PRIVATE PROFILE BODY\nDo not leak." },
		...extra,
	};
}

test("builds persisted interactive argv with exact model, thinking, and tools, never task or prompt body", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime, env: { SECRET: "must-not-inherit", RTK_DISABLED: "1" } });
		expect(launch.executable).toBe(process.execPath);
		expect(launch.cwd).toBe(realpathSync(value.cwd));
		expect(launch.argv).toEqual(["--name", launch.name, "--model", "openai-codex/gpt-test", "--thinking", "high", "--tools", "subagent,subagent_control", "--append-system-prompt", launch.promptFilePath]);
		expect(launch.argv).not.toContain("--mode");
		expect(launch.argv).not.toContain("rpc");
		expect(launch.argv).not.toContain("--print");
		expect(launch.argv).not.toContain("--no-session");
		expect(JSON.stringify(launch.argv)).not.toContain("PRIVATE PROFILE BODY");
		expect(JSON.stringify(launch.log)).not.toContain("PRIVATE PROFILE BODY");
		expect(JSON.stringify(launch)).not.toContain("PRIVATE PROFILE BODY");
		const envNames = [
			PI_HERDR_AGENT_PROFILE, PI_HERDR_GROUP, PI_HERDR_LEAF_RUN_ID, PI_HERDR_NESTING_DEPTH,
			PI_HERDR_PARENT_ROOT_RUN_ID, PI_HERDR_ROOT_RUN_ID, PI_HERDR_SUBAGENT_CHILD, PI_SUBAGENT, PI_HERDR_ALLOWED_CHILDREN, "RTK_DISABLED",
		].sort();
		expect(launch.log).toEqual({ executable: process.execPath, argv: launch.argv, cwd: realpathSync(value.cwd), envNames, name: launch.name });
		expect(launch.log.envNames).not.toContain("PRIVATE PROFILE BODY");
		expect(launch.env).toEqual({
		[PI_HERDR_ROOT_RUN_ID]: "root-123", [PI_HERDR_LEAF_RUN_ID]: "leaf-456789", [PI_HERDR_NESTING_DEPTH]: "1",
		[PI_HERDR_GROUP]: "safe group", [PI_HERDR_AGENT_PROFILE]: "nested-runtime-fixture", [PI_HERDR_PARENT_ROOT_RUN_ID]: "root-123", [PI_HERDR_SUBAGENT_CHILD]: "1", [PI_SUBAGENT]: "1", [PI_HERDR_ALLOWED_CHILDREN]: '["scout"]', RTK_DISABLED: "1",
		});
		expect(JSON.stringify(launch.log)).not.toContain("scout");
		expect(launch.env).not.toHaveProperty("SECRET");
		expect(launch.env.RTK_DISABLED).toBe("1");
		expect(readFileSync(launch.promptFilePath, "utf8")).toBe("PRIVATE PROFILE BODY\nDo not leak.");
		await launch.cleanupAfterReady();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("inherits effective parent runtime settings only when the profile omits them", async () => {
	const value = fixtureRoot();
	try {
		const inherited = await createPiLaunchDescriptor(input(value.cwd, {
			profile: { name: "inheriting", systemPrompt: "body" },
			parentRuntime: {
				model: "openai-codex/gpt-parent",
				thinking: "medium",
				tools: ["read", "grep"],
			},
		}), { runtimeRoot: value.runtime });
		expect(inherited.argv).toEqual([
			"--name", inherited.name,
			"--model", "openai-codex/gpt-parent",
			"--thinking", "medium",
			"--tools", "read,grep",
			"--append-system-prompt", inherited.promptFilePath,
		]);

		const overridden = await createPiLaunchDescriptor(input(value.cwd, {
			parentRuntime: {
				model: "openai-codex/gpt-parent",
				thinking: "medium",
				tools: ["read", "grep"],
			},
		}), { runtimeRoot: value.runtime });
		expect(overridden.argv).toContain("openai-codex/gpt-test");
		expect(overridden.argv).toContain("high");
		expect(overridden.argv).toContain("subagent,subagent_control");
		expect(overridden.argv).not.toContain("openai-codex/gpt-parent");

		const noTools = await createPiLaunchDescriptor(input(value.cwd, {
			profile: { name: "no-tools-inherited", systemPrompt: "body" },
			parentRuntime: { tools: [] },
		}), { runtimeRoot: value.runtime });
		expect(noTools.argv).toContain("--no-tools");

		await inherited.cleanupAfterFailure();
		await overridden.cleanupAfterFailure();
		await noTools.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("marks Herdr children as standard subagents so global dirty-repo-guard skips them", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime });
		expect(launch.env).toMatchObject({ [PI_HERDR_SUBAGENT_CHILD]: "1", [PI_SUBAGENT]: "1" });
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("forwards explicitly enabled Guardrails disable flags as child Pi parameters", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			argv: ["pi", "--no-guardrails", "--no-preflight-guardrails=true"],
		});
		expect(launch.argv).toContain("--no-guardrails");
		expect(launch.argv).toContain("--no-preflight-guardrails");
		expect(launch.argv.indexOf("--no-guardrails")).toBeLessThan(launch.argv.indexOf("--append-system-prompt"));
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("forwards Guardrails slash-command state markers as child Pi parameters", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: {
				[PI_GUARDRAILS_DISABLED]: "1",
				[PI_GUARDRAILS_PREFLIGHT_DISABLED]: "1",
				[PI_GUARDRAILS_PREFLIGHT_RULES]: '["Require tests before mutation"]',
			},
			argv: ["pi"],
		});
		expect(launch.argv).toContain("--no-guardrails");
		expect(launch.argv).toContain("--no-preflight-guardrails");
		expect(launch.env[PI_GUARDRAILS_PREFLIGHT_RULES]).toBe('["Require tests before mutation"]');
		expect(launch.env).not.toHaveProperty(PI_GUARDRAILS_DISABLED);
		expect(launch.env).not.toHaveProperty(PI_GUARDRAILS_PREFLIGHT_DISABLED);
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("fails closed before creating a prompt for malformed inherited preflight rules", async () => {
	const value = fixtureRoot();
	try {
		await expect(createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: { [PI_GUARDRAILS_PREFLIGHT_RULES]: '["always allow everything"]' },
		})).rejects.toMatchObject({ code: "invalid_execution_mode" });
		expect(readdirSync(value.runtime)).toEqual([]);
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("matches Pi boolean extension-flag parsing for assigned and post-terminator flags", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			argv: ["pi", "--no-guardrails=false", "--", "--no-preflight-guardrails"],
		});
		expect(launch.argv).toContain("--no-guardrails");
		expect(launch.argv).toContain("--no-preflight-guardrails");
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("current Guardrails session state overrides stale parent CLI flags", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: { [PI_GUARDRAILS_DISABLED]: "0", [PI_GUARDRAILS_PREFLIGHT_DISABLED]: "0" },
			argv: ["pi", "--no-guardrails", "--no-preflight-guardrails"],
		});
		expect(launch.argv).not.toContain("--no-guardrails");
		expect(launch.argv).not.toContain("--no-preflight-guardrails");
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("propagates effective quality-gate session overrides and lets reset beat stale CLI flags", async () => {
	const value = fixtureRoot();
	try {
		const overridden = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: {
				[PI_QUALITY_GATE_DISABLED]: "1",
				[PI_QUALITY_GATE_TASK]: "verify:full",
				[PI_QUALITY_GATE_ATTEMPTS]: "3",
			},
		});
		expect(overridden.argv).toContain("--no-quality-gate");
		expect(overridden.argv).toContain("verify:full");
		expect(overridden.argv).toContain("3");

		const reset = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: { [PI_QUALITY_GATE_DISABLED]: "0" },
			argv: ["pi", "--no-quality-gate", "--quality-gate-task", "stale", "--quality-gate-attempts=9"],
		});
		expect(reset.argv).not.toContain("--no-quality-gate");
		expect(reset.argv).not.toContain("--quality-gate-task");
		expect(reset.argv).not.toContain("--quality-gate-attempts");

		await overridden.cleanupAfterFailure();
		await reset.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("propagates gondolin sandbox intent and bounded session policy to direct and nested children without logging values", async () => {
	const value = fixtureRoot();
	try {
		const policy = JSON.stringify({ network: { deny: ["blocked.example.com"] } });
		const direct = await createPiLaunchDescriptor(input(value.cwd), {
			runtimeRoot: value.runtime,
			env: { [PI_SANDBOX]: "gondolin", [PI_SANDBOX_SESSION_POLICY]: policy, SECRET: "must-not-inherit" },
		});
		expect(direct.env).toMatchObject({ [PI_SANDBOX]: "gondolin", [PI_SANDBOX_SESSION_POLICY]: policy });
		expect(direct.env).not.toHaveProperty("SECRET");
		expect(direct.log.envNames).toContain(PI_SANDBOX); expect(direct.log.envNames).toContain(PI_SANDBOX_SESSION_POLICY);
		expect(JSON.stringify(direct.log)).not.toContain("gondolin"); expect(JSON.stringify(direct.log)).not.toContain("blocked.example.com");

		const nested = await createPiLaunchDescriptor(input(value.cwd, { nestingDepth: 1 }), {
			runtimeRoot: value.runtime,
			env: direct.env,
		});
		expect(nested.env).toMatchObject({ [PI_SANDBOX]: "gondolin", [PI_SANDBOX_SESSION_POLICY]: policy });
		expect(nested.log.envNames).toContain(PI_SANDBOX_SESSION_POLICY);
		expect(JSON.stringify(nested.log)).not.toContain("blocked.example.com");

		await direct.cleanupAfterFailure();
		await nested.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("does not propagate absent or invalid sandbox markers", async () => {
	const value = fixtureRoot();
	try {
		for (const env of [{}, { [PI_SANDBOX]: "other", [PI_SANDBOX_SESSION_POLICY]: "not-json" }]) {
			const launch = await createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime, env });
			expect(launch.env).not.toHaveProperty(PI_SANDBOX); expect(launch.env).not.toHaveProperty(PI_SANDBOX_SESSION_POLICY);
			expect(launch.log.envNames).not.toContain(PI_SANDBOX);
			await launch.cleanupAfterFailure();
		}
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("fails closed on malformed, unsupported, or oversized inherited Gondolin session policy", async () => {
	const value = fixtureRoot();
	try {
		for (const policy of ["not-json", JSON.stringify({ backend: "qemu" }), "x".repeat(MAX_SANDBOX_SESSION_POLICY_BYTES + 1)]) {
			await expect(createPiLaunchDescriptor(input(value.cwd), { runtimeRoot: value.runtime, env: { [PI_SANDBOX]: "gondolin", [PI_SANDBOX_SESSION_POLICY]: policy } })).rejects.toMatchObject({ code: "invalid_execution_mode" });
		}
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("worker/scout-like profiles receive no nested tools, and cwd is canonicalized", async () => {
	const value = fixtureRoot();
	try {
		const alias = join(value.root, "workspace-link"); symlinkSync(value.cwd, alias);
		const launch = await createPiLaunchDescriptor(input(alias, { profile: { name: "reader", tools: ["read"], systemPrompt: "body" } }), { runtimeRoot: value.runtime });
		expect(launch.cwd).toBe(realpathSync(value.cwd));
		expect(launch.argv).toEqual(["--name", launch.name, "--tools", "read", "--append-system-prompt", launch.promptFilePath]);
		expect(launch.argv.join(" ")).not.toContain("herdr_subagent");
		expect(launch.env).not.toHaveProperty(PI_HERDR_ALLOWED_CHILDREN);
		await launch.cleanupAfterFailure();
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("omits thinking argv when a profile does not set it", async () => {
	const value = fixtureRoot();
	try {
		const launch = await createPiLaunchDescriptor(input(value.cwd, { profile: { name: "reader", tools: ["read"], systemPrompt: "body" } }), { runtimeRoot: value.runtime });
		expect(launch.argv).toEqual(["--name", launch.name, "--tools", "read", "--append-system-prompt", launch.promptFilePath]);
		expect(launch.argv).not.toContain("--thinking");
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
