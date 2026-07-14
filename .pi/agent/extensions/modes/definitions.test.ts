import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadModes, resolveRequestedSkills } from "./definitions.js";

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
tools: read, grep, find, ls, edit, write, bash
skills: caveman, implementation-workflow
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

	it("rejects duplicate commands", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "one.md"), "---\ncommand: quick\n---\na");
		writeFileSync(join(root, "two.md"), "---\ncommand: quick\n---\nb");

		expect(() => loadModes(root)).toThrow('Duplicate mode command: "quick"');

		rmSync(root, { recursive: true, force: true });
	});
});

describe("resolveRequestedSkills", () => {
	it("preserves declared order and rejects missing or ambiguous skills", () => {
		const available = [
			{ name: "caveman", filePath: "/skills/caveman/SKILL.md" },
			{ name: "implementation-workflow", filePath: "/skills/implementation/SKILL.md" },
		];

		expect(resolveRequestedSkills(["implementation-workflow", "caveman"], available)).toEqual([
			{ name: "implementation-workflow", filePath: "/skills/implementation/SKILL.md" },
			{ name: "caveman", filePath: "/skills/caveman/SKILL.md" },
		]);
		expect(() => resolveRequestedSkills(["missing"], available)).toThrow('Mode requests unavailable skill: "missing"');
		expect(() => resolveRequestedSkills(["caveman"], [...available, available[0]])).toThrow('Mode skill is ambiguous: "caveman"');
	});
});
