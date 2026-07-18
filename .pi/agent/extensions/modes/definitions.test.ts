import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadModes, replaceSkillIndex, resolveRequestedSkills, selectModeSkills } from "./definitions.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-modes-test-"));
}

describe("loadModes", () => {
	it("loads a mode with normalized frontmatter lists and prompt body", () => {
		const root = makeTempDir();
		writeFileSync(
			join(root, "quick.md"),
			`---
command: quick
description: Direct small work
model: openai-codex/gpt-5.6-luna
tools: [read, grep, find, ls, edit, write, bash]
skills:
  - caveman
  - implementation-workflow
thinking: low
---
# Quick

Do the smallest useful thing.`,
		);

		const modes = loadModes(root);

		expect(modes).toEqual([
			{
				command: "quick",
				description: "Direct small work",
				model: "openai-codex/gpt-5.6-luna",
				tools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
				skills: ["caveman", "implementation-workflow"],
				thinking: "low",
				systemPrompt: "# Quick\n\nDo the smallest useful thing.",
				filePath: join(root, "quick.md"),
			},
		]);

		rmSync(root, { recursive: true, force: true });
	});

	it("preserves a quoted @tier model alias", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "work.md"), "---\ncommand: work\nmodel: \"@medium\"\n---\nBounded work.");

		expect(loadModes(root)[0]?.model).toBe("@medium");
		rmSync(root, { recursive: true, force: true });
	});

	it("accepts a bare model ID for resolution through defaultProvider at activation", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "quick.md"), "---\ncommand: quick\nmodel: gpt-5.6-luna\n---\nDirect work.");

		expect(loadModes(root)[0]?.model).toBe("gpt-5.6-luna");
		rmSync(root, { recursive: true, force: true });
	});

	it("inherits active-session settings when optional frontmatter is absent", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "observe.md"), "---\ncommand: observe\n---\nRead carefully.");

		expect(loadModes(root)).toEqual([
			{
				command: "observe",
				description: "Activate observe mode",
				model: undefined,
				tools: undefined,
				skills: undefined,
				thinking: undefined,
				systemPrompt: "Read carefully.",
				filePath: join(root, "observe.md"),
			},
		]);

		rmSync(root, { recursive: true, force: true });
	});

	it("accepts skills: [] as an explicit empty visible-skill list", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "quick.md"), "---\ncommand: quick\nskills: []\n---\nDirect work.");

		expect(loadModes(root)[0]?.skills).toEqual([]);
		rmSync(root, { recursive: true, force: true });
	});

	it("accepts block-style YAML arrays for tools", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "work.md"), "---\ncommand: work\ntools:\n  - read\n  - grep\n---\nBounded work.");

		expect(loadModes(root)[0]?.tools).toEqual(["read", "grep"]);
		rmSync(root, { recursive: true, force: true });
	});

	it("rejects scalar list fields", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "quick.md"), "---\ncommand: quick\ntools: read, grep\nskills: caveman\n---\nDirect work.");

		expect(() => loadModes(root)).toThrow("tools must be a YAML array of strings");
		rmSync(root, { recursive: true, force: true });
	});

	it("rejects duplicate commands", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "one.md"), "---\ncommand: quick\n---\na");
		writeFileSync(join(root, "two.md"), "---\ncommand: quick\n---\nb");

		expect(() => loadModes(root)).toThrow('Duplicate mode command: "quick"');

		rmSync(root, { recursive: true, force: true });
	});
});

it("orchestrate mode exposes orchestration tools", () => {
	const mode = loadModes(join(import.meta.dir, "..", "..", "modes")).find(value => value.command === "orchestrate");
	expect(mode?.tools).toEqual(["subagent", "subagent_control", "read", "grep", "find", "ls"]);
	expect(mode?.systemPrompt).toContain("no background/RPC fallback");
});

describe("mode skill selection", () => {
	const available = [
		{ name: "caveman", filePath: "/skills/caveman/SKILL.md" },
		{ name: "implementation-workflow", filePath: "/skills/implementation/SKILL.md" },
	];

	it("uses a declared list as the visible skill allowlist without reading skill files", () => {
		expect(resolveRequestedSkills(["implementation-workflow", "caveman"], available)).toEqual([
			{ name: "implementation-workflow", filePath: "/skills/implementation/SKILL.md" },
			{ name: "caveman", filePath: "/skills/caveman/SKILL.md" },
		]);
		expect(() => resolveRequestedSkills(["missing"], available)).toThrow('Mode requests unavailable skill: "missing"');
		expect(() => resolveRequestedSkills(["caveman"], [...available, available[0]])).toThrow('Mode skill is ambiguous: "caveman"');
	});

	it("keeps all normally discovered skills visible when skills is omitted", () => {
		expect(selectModeSkills(undefined, available)).toEqual(available);
	});

	it("uses skills: [] to hide every visible skill without loading any skill body", () => {
		expect(selectModeSkills([], available)).toEqual([]);
		const prompt = "base\n\n<available_skills>all</available_skills>\nend";
		expect(replaceSkillIndex(prompt, "<available_skills>all</available_skills>", "")).toBe("base\n\n\nend");
	});

	it("replaces only Pi's skill index and never injects full skill text", () => {
		const prompt = "base\n\n<available_skills>all</available_skills>\nend";
		const filtered = replaceSkillIndex(
			prompt,
			"<available_skills>all</available_skills>",
			"<available_skills>implementation-workflow</available_skills>",
		);

		expect(filtered).toBe("base\n\n<available_skills>implementation-workflow</available_skills>\nend");
		expect(filtered).not.toContain("<mode_skill");
		expect(() => replaceSkillIndex("base", "<available_skills>all</available_skills>", "")).toThrow("Mode skill index was not found");
	});
});
