import { describe, expect, it } from "bun:test";
import { csvReport, formatToken, textReport } from "./render.js";
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
	it("formats token quantities with explicit compact units at every boundary", () => {
		expect(formatToken(999)).toBe("999");
		expect(formatToken(1_000)).toBe("1.0k");
		expect(formatToken(13_000)).toBe("13k");
		expect(formatToken(999_499)).toBe("999k");
		expect(formatToken(999_500)).toBe("1.0M");
		expect(formatToken(1_000_000)).toBe("1.0M");
	});

	it("uses the same ordered data columns in flat text and CSV", () => {
		const textHeader = textReport("Report", [row], { label: "test", startMs: 0, endMs: 1 }).split("\n")[2]!;
		expect(textHeader.split(/ {2,}/)).toEqual(["Key", ...standard]);

		const csvHeader = csvReport([row]).split("\n")[0]!;
		expect(csvHeader.split(",")).toEqual(["key", "sessions", "turns", "input", "cacheRead", "cacheWrite", "output", "reasoning", "cost", "cacheReadRate"]);
	});
});
