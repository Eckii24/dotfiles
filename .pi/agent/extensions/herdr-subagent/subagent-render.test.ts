import { expect, test } from "bun:test";
import { renderSubagentCall, renderSubagentResult } from "./subagent-render.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

test("running call shows group, mode, profile names, and prompts without model or tools", () => {
	const component = renderSubagentCall({
		group: "Scout codebase",
		tasks: [
			{ name: "api", agent: "scout", task: "Find API boundaries." },
			{ name: "tests", agent: "code-reviewer", task: "Find relevant tests." },
		],
	} as any, theme, { expanded: false });
	const output = component.render(200).join("\n");
	expect(output).toContain("Scout codebase · parallel · 2 panes");
	expect(output).toContain("api · scout · working");
	expect(output).toContain("Find API boundaries.");
	expect(output).not.toContain("model");
	expect(output).not.toContain("tools");
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
