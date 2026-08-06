import { describe, expect, it } from "bun:test";
import { renderTreeTable, type TreeNode } from "./tree.js";

describe("renderTreeTable", () => {
	it("renders a multi-group hierarchy as aligned ASCII table rows", () => {
		const nodes: TreeNode[] = [{ key: "project-a", label: "project-a", cost: 2, input: 1_000_000, cacheRead: 100_000, cacheWrite: 0, output: 10, reasoning: 0, turns: 1, children: [{ key: "session-a", label: "session-a", cost: 2, input: 1_000_000, cacheRead: 100_000, cacheWrite: 0, output: 10, reasoning: 0, turns: 1, children: [] }] }];
		const report = renderTreeTable(nodes, ["project", "session"], 20);
		expect(report).toContain("Project");
		expect(report).toContain("Session");
		expect(report).toContain("project-a");
		expect(report).toContain("session-a");
		expect(report).toContain("$2.0000");
		expect(report).toContain("1.0M");
		expect(report).toContain("100k");
	});
});
