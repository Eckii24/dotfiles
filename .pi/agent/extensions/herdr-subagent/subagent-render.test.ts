import { expect, test } from "bun:test";
import { renderSubagentCall, renderSubagentResult } from "./subagent-render.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

test("running call shows group, mode, profile names, and prompts without model or tools", () => {
	const component = renderSubagentCall({
		group: "Scout codebase",
		mode: "parallel",
		tasks: [
			{ name: "api", agent: "scout", task: "Find API boundaries." },
			{ name: "tests", agent: "code-reviewer", task: "Find relevant tests." },
		],
	} as any, theme, { expanded: false });
	const output = component.render(200).join("\n");
	expect(output).toContain("Scout codebase · parallel · 2 panes");
	expect(output).toContain("api · scout · working");
	expect(output).toContain("tests · code-reviewer · working");
	expect(output).toContain("Find API boundaries.");
	expect(output).toContain("Find relevant tests.");
	expect(output).not.toContain("model");
	expect(output).not.toContain("tools");
});

test("one-item task or chain calls render as single", () => {
	for (const [mode, field] of [["parallel", "tasks"], ["chain", "chain"]] as const) {
		const component = renderSubagentCall({
			group: "One child", mode,
			[field]: [{ name: "only", agent: "scout", task: "Inspect." }],
		} as any, theme, { expanded: false });
		const output = component.render(200).join("\n");
		expect(output).toContain("One child · single");
		expect(output).toContain("only · scout · working");
		expect(output).not.toContain(mode === "parallel" ? "parallel ·" : "chain ·");
	}
});

test("running call ignores materialized inactive mode fields", () => {
	const component = renderSubagentCall({
		group: "Plan work item",
		mode: "single",
		agent: "project-memory-manager",
		task: "Update current work.",
		tasks: [{ name: "unused", agent: "scout", task: "unused" }],
		chain: [{ name: "unused", agent: "scout", task: "unused" }],
	} as any, theme, { expanded: false });
	const output = component.render(200).join("\n");
	expect(output).toContain("Plan work item · single");
	expect(output).toContain("project-memory-manager · working");
	expect(output).toContain("Update current work.");
	expect(output).not.toContain("unused");
});

test("expanded result lists completed leaves and their output", () => {
	const component = renderSubagentResult({
		content: [{ type: "text", text: "done" }],
		details: { group: "Scout codebase", status: "succeeded", children: [{ name: "api", agent: "scout", status: "succeeded", finalOutput: "Found routes." }] },
	}, { expanded: true }, theme);
	const output = component.render(200).join("\n");
	expect(output).toContain("✓ Scout codebase · succeeded");
	expect(output).toContain("api · scout · succeeded");
	expect(output).toContain("Found routes.");
});
