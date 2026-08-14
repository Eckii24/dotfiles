import { describe, expect, it } from "bun:test";
import { renderTreeTable, type TreeNode } from "./tree.js";

describe("renderTreeTable", () => {
	it("renders a multi-group hierarchy as aligned ASCII table rows", () => {
		const nodes: TreeNode[] = [{ key: "project-a", label: "project-a", cost: 2, input: 1_000_000, cacheRead: 100_000, cacheWrite: 0, output: 10, reasoning: 0, turns: 1, uniqueSessions: 1, cacheReadRate: 0.1, children: [{ key: "session-a", label: "session-a", cost: 2, input: 1_000_000, cacheRead: 100_000, cacheWrite: 0, output: 10, reasoning: 0, turns: 1, uniqueSessions: 1, cacheReadRate: 0.1, children: [] }] }];
		const report = renderTreeTable(nodes, ["project", "session"], 20);
		expect(report).toContain("Project");
		expect(report).toContain("Session");
		expect(report).toContain("project-a");
		expect(report).toContain("session-a");
		expect(report).toContain("$2.0000");
		expect(report).toContain("1.0M");
		expect(report).toContain("100k");
		expect(report).not.toContain("undefined");
		expect(report.split("\n")[0]!.split(/ {2,}/).slice(-9)).toEqual(["Sessions", "Turns", "Input", "C.Read", "C.Write", "Output", "Reason", "Cost", "Cache"]);
	});
	it("renders post-order subtotals without separating items from their sum", () => {
		const leaf = (label: string, cost: number): TreeNode => ({ key: label, label, cost, input: 1, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0, turns: 1, uniqueSessions: 1, cacheReadRate: 0, children: [] });
		const worker: TreeNode = { ...leaf("worker", 3), children: [leaf("scout", 1), leaf("review", 2)] };
		const main: TreeNode = { ...leaf("main", 4), children: [leaf("main-session", 4)] };
		const thread: TreeNode = { ...leaf("Thread A", 7), children: [worker, main] };
		const report = renderTreeTable([thread], ["thread", "agent", "session"], 20, ["agent", "thread"]);
		const lines = report.split("\n");
		const scout = lines.findIndex((line) => line.includes("scout"));
		const workerTotal = lines.findIndex((line) => line.includes("worker Σ"));
		const threadTotal = lines.findIndex((line) => line.includes("Thread A Σ"));
		expect(scout).toBeGreaterThan(0);
		expect(workerTotal).toBe(scout + 2);
		expect(lines[workerTotal + 1]).toBe("");
		expect(lines[workerTotal + 2]).toContain("main-session");
		expect(threadTotal).toBe(lines.length - 1);
	});
});
