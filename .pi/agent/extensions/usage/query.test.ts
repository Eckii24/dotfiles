import { describe, expect, it } from "bun:test";
import { parseUsageQuery } from "./query.js";

describe("parseUsageQuery", () => {
	it("defaults --usage to current month and overview grouping", () => {
		const q = parseUsageQuery(["pi", "--usage"], new Date("2026-08-06T12:00:00"));
		expect(q.range.label).toBe("2026-08");
		expect(q.groupBy).toEqual([]);
	});
	it("parses composable outer-to-inner groups", () => {
		const q = parseUsageQuery(["pi", "--usage", "--group-by", "session,agent,model", "--period", "2026-07"]);
		expect(q.groupBy).toEqual(["session", "agent", "model"]);
		expect(q.range.label).toBe("2026-07");
	});
	it("rejects old mode syntax and invalid duplicate groups", () => {
		expect(() => parseUsageQuery(["pi", "--usage=models"])).toThrow("Use --usage");
		expect(() => parseUsageQuery(["pi", "--usage", "--group-by", "session,session"])).toThrow("unique");
	});

	it("rejects a misspelled group selector instead of silently defaulting to session", () => {
		expect(() => parseUsageQuery(["pi", "--usage", "--anomalies", "--groupy-by", "project"])).toThrow("--group-by");
	});
});
