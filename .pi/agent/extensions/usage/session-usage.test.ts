import { describe, expect, it } from "bun:test";
import { getSessionUsageTotals } from "./session-usage.js";

function assistantMessage(
	timestamp: string,
	usage: { input: number; cacheRead: number; output: number; total: number },
	provider = "anthropic",
	model = "claude-sonnet-4.5",
) {
	return {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		provider,
		model,
		timestamp: Date.parse(timestamp),
		usage: {
			input: usage.input,
			cacheRead: usage.cacheRead,
			cacheWrite: 0,
			output: usage.output,
			totalTokens: usage.input + usage.cacheRead + usage.output,
			cost: {
				input: 0,
				cacheRead: 0,
				cacheWrite: 0,
				output: 0,
				total: usage.total,
			},
		},
	};
}

function subagentToolResult(timestamp: string, details: unknown) {
	return {
		role: "toolResult",
		toolCallId: "call_subagent",
		toolName: "subagent",
		content: [{ type: "text", text: "done" }],
		isError: false,
		details,
		timestamp: Date.parse(timestamp),
	};
}

describe("getSessionUsageTotals", () => {
	it("counts assistant usage nested inside subagent tool results", () => {
		const nestedDetails = {
			version: 2,
			run: {
				id: "nested-root",
				mode: "single",
				status: "succeeded",
				agentScope: "user",
				projectAgentsDir: null,
				createdAt: Date.parse("2026-06-03T09:00:00Z"),
				updatedAt: Date.parse("2026-06-03T09:01:00Z"),
				startedAt: Date.parse("2026-06-03T09:00:00Z"),
				endedAt: Date.parse("2026-06-03T09:01:00Z"),
				children: [
					{
						id: "nested-leaf",
						agent: "worker",
						agentSource: "user",
						task: "nested",
						status: "succeeded",
						messages: [assistantMessage("2026-06-03T09:00:30Z", { input: 7, cacheRead: 3, output: 2, total: 0.01 })],
						stderr: "",
						usage: { input: 7, cacheRead: 3, cacheWrite: 0, output: 2, cost: 0.01, contextTokens: 12, turns: 1 },
						queue: { steering: [], followUp: [] },
						steeringHistory: [],
						controllable: false,
					},
				],
			},
		};
		const details = {
			version: 2,
			run: {
				id: "root-run",
				mode: "single",
				status: "succeeded",
				agentScope: "user",
				projectAgentsDir: null,
				createdAt: Date.parse("2026-06-03T08:00:00Z"),
				updatedAt: Date.parse("2026-06-03T08:02:00Z"),
				startedAt: Date.parse("2026-06-03T08:00:00Z"),
				endedAt: Date.parse("2026-06-03T08:02:00Z"),
				children: [
					{
						id: "leaf-1",
						agent: "worker",
						agentSource: "user",
						task: "outer",
						status: "succeeded",
						messages: [
							assistantMessage("2026-06-03T08:00:30Z", { input: 11, cacheRead: 5, output: 4, total: 0.02 }, "openai", "gpt-4o"),
							subagentToolResult("2026-06-03T08:01:00Z", nestedDetails),
						],
						stderr: "",
						usage: { input: 11, cacheRead: 5, cacheWrite: 0, output: 4, cost: 0.02, contextTokens: 20, turns: 1 },
						queue: { steering: [], followUp: [] },
						steeringHistory: [],
						controllable: false,
					},
				],
			},
		};

		const totals = getSessionUsageTotals([
			{
				type: "message",
				message: subagentToolResult("2026-06-03T08:02:00Z", details),
			},
		]);

		expect(totals).toEqual({ input: 18, cacheRead: 8, output: 6, cost: 0.03 });
	});

	it("falls back to stored snapshot usage when legacy results have no messages", () => {
		const totals = getSessionUsageTotals([
			{
				type: "message",
				message: subagentToolResult("2026-06-04T11:01:00Z", {
					mode: "parallel",
					agentScope: "user",
					projectAgentsDir: null,
					results: [
						{
							agent: "worker",
							agentSource: "user",
							task: "legacy",
							exitCode: 0,
							messages: [],
							stderr: "",
							usage: { input: 9, cacheRead: 2, cacheWrite: 0, output: 3, cost: 0.04, contextTokens: 14, turns: 1 },
						},
					],
				}),
			},
		]);

		expect(totals).toEqual({ input: 9, cacheRead: 2, output: 3, cost: 0.04 });
	});
});
