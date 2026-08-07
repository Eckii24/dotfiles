import { describe, expect, it } from "bun:test";
import { csvReport, textReport } from "./render.js";
import type { Row } from "./analytics.js";

const row: Row = {
	key: "model-a",
	metrics: {
		uniqueSessions: 2, assistantTurns: 3, input: 4, cacheRead: 5, cacheWrite: 6,
		output: 7, reasoning: 8, totalTokens: 30, cost: 9, cacheReadRate: 0.25,
		toolCalls: 0, toolErrors: 0, subagentCalls: 0, sessionDays: 2, activeDurationMs: 0,
	},
};

const standard = ["Sessions", "Turns", "Input", "C.Read", "C.Write", "Output", "Reason", "Cost", "Cache"];

describe("tabular usage reports", () => {
	it("uses the same ordered data columns in flat text and CSV", () => {
		const textHeader = textReport("Report", [row], { label: "test", startMs: 0, endMs: 1 }).split("\n")[2]!;
		expect(textHeader.split(/ {2,}/)).toEqual(["Key", ...standard]);

		const csvHeader = csvReport([row]).split("\n")[0]!;
		expect(csvHeader.split(",")).toEqual(["key", "sessions", "turns", "input", "cacheRead", "cacheWrite", "output", "reasoning", "cost", "cacheReadRate"]);
	});
});
