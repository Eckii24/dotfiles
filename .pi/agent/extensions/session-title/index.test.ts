import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTitleArgs, loadSessionTitleModel, sanitizeTitle, shouldGenerateTitle } from "./title-generator.ts";
import { registerSessionTitle } from "./index.ts";

describe("session-title generator", () => {
	const temporaryDirectories: string[] = [];
	afterEach(() => {
		for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
	});

	it("builds an isolated ephemeral title-model invocation from only the first message", () => {
		const args = buildTitleArgs("Investigate native Pi session names", "openai-codex/gpt-5.6-luna");

		expect(args).toEqual([
			"-p",
			expect.stringContaining("Investigate native Pi session names"),
			"--model",
			"openai-codex/gpt-5.6-luna",
			"--no-session",
			"--no-tools",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--no-themes",
			"--thinking",
			"off",
		]);
	});

	it("uses @tiny by default and accepts a configured model", () => {
		const defaultAgentDir = mkdtempSync(join(tmpdir(), "session-title-default-"));
		temporaryDirectories.push(defaultAgentDir);
		expect(loadSessionTitleModel(defaultAgentDir)).toBe("@tiny");

		const configuredAgentDir = mkdtempSync(join(tmpdir(), "session-title-configured-"));
		temporaryDirectories.push(configuredAgentDir);
		writeFileSync(join(configuredAgentDir, "settings.json"), JSON.stringify({
			sessionTitle: { model: "@small" },
		}));
		expect(loadSessionTitleModel(configuredAgentDir)).toBe("@small");
	});

	it("normalizes a one-line title and rejects empty model output", () => {
		expect(sanitizeTitle('  "Native Pi session titles"  \nignored')).toBe("Native Pi session titles");
		expect(sanitizeTitle(" \n 	 ")).toBeUndefined();
	});

	it("runs only once for a persisted unnamed session", () => {
		expect(shouldGenerateTitle(false, "/tmp/session.jsonl", undefined)).toBeTrue();
		expect(shouldGenerateTitle(false, undefined, undefined)).toBeFalse();
		expect(shouldGenerateTitle(false, "/tmp/session.jsonl", "External title")).toBeFalse();
		expect(shouldGenerateTitle(true, "/tmp/session.jsonl", undefined)).toBeFalse();
	});

	it("resets its attempt state when Goal replaces the active session", async () => {
		const handlers = new Map<string, any>();
		let sessionName: string | undefined;
		const prompts: string[] = [];
		const pi = {
			on(name: string, handler: any) { handlers.set(name, handler); },
			getSessionName() { return sessionName; },
			setSessionName(value: string) { sessionName = value; },
		};
		registerSessionTitle(pi as any, async (prompt) => {
			prompts.push(prompt);
			return `Title ${prompts.length}`;
		});
		const ctx = { cwd: "/repo", sessionManager: { getSessionFile: () => "/tmp/session.jsonl" } };

		await handlers.get("before_agent_start")({ prompt: "first" }, ctx);
		sessionName = undefined;
		await handlers.get("before_agent_start")({ prompt: "same session" }, ctx);
		expect(prompts).toEqual(["first"]);

		await handlers.get("session_start")({}, ctx);
		await handlers.get("before_agent_start")({ prompt: "goal session" }, ctx);
		expect(prompts).toEqual(["first", "goal session"]);
		expect(sessionName).toBe("Title 2");
	});
});
