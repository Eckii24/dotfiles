import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMonthlyUsageSummary, formatDetailedMonthlyUsageReport, formatMonthlyUsageReport } from "./report.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "usage-report-test-"));
}

function writeSessionFile(rootDir: string, relativePath: string, content: string, modifiedAt: Date): string {
	const fullPath = join(rootDir, relativePath);
	mkdirSync(join(fullPath, ".."), { recursive: true });
	writeFileSync(fullPath, content);
	utimesSync(fullPath, modifiedAt, modifiedAt);
	return fullPath;
}

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

describe("buildMonthlyUsageSummary", () => {
	it("aggregates assistant usage per local day", async () => {
		const root = makeTempDir();
		const now = new Date("2026-06-20T12:00:00Z");
		const file = [
			JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-06-01T08:00:00Z", cwd: "/repo" }),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-06-01T10:00:00Z",
				message: assistantMessage("2026-06-01T10:00:00Z", { input: 100, cacheRead: 40, output: 25, total: 0.12 }),
			}),
			JSON.stringify({
				type: "message",
				id: "m2",
				parentId: "m1",
				timestamp: "2026-06-02T10:00:00Z",
				message: assistantMessage("2026-06-02T10:00:00Z", { input: 50, cacheRead: 10, output: 15, total: 0.03 }),
			}),
		].join("\n");

		writeSessionFile(root, "project/session.jsonl", file, now);
		const summary = await buildMonthlyUsageSummary({ sessionDir: root, now });

		expect(summary.days).toEqual([
			{ day: "2026-06-01", totals: { input: 100, cacheRead: 40, output: 25, cost: 0.12, chats: 1, subagentCalls: 0 } },
			{ day: "2026-06-02", totals: { input: 50, cacheRead: 10, output: 15, cost: 0.03, chats: 1, subagentCalls: 0 } },
		]);
		expect(summary.totals).toEqual({ input: 150, cacheRead: 50, output: 40, cost: 0.15, chats: 2, subagentCalls: 0 });
		expect(summary.dailyModels).toEqual([
			{
				day: "2026-06-01",
				models: [
					{
						provider: "anthropic",
						model: "claude-sonnet-4.5",
						providerModel: "anthropic/claude-sonnet-4.5",
						totals: { input: 100, cacheRead: 40, output: 25, cost: 0.12, chats: 1, subagentCalls: 0 },
					},
				],
			},
			{
				day: "2026-06-02",
				models: [
					{
						provider: "anthropic",
						model: "claude-sonnet-4.5",
						providerModel: "anthropic/claude-sonnet-4.5",
						totals: { input: 50, cacheRead: 10, output: 15, cost: 0.03, chats: 1, subagentCalls: 0 },
					},
				],
			},
		]);
		expect(summary.models).toEqual([
			{
				provider: "anthropic",
				model: "claude-sonnet-4.5",
				providerModel: "anthropic/claude-sonnet-4.5",
				totals: { input: 150, cacheRead: 50, output: 40, cost: 0.15, chats: 1, subagentCalls: 0 },
			},
		]);

		rmSync(root, { recursive: true, force: true });
	});

	it("counts nested subagent usage stored in tool results", async () => {
		const root = makeTempDir();
		const now = new Date("2026-06-20T12:00:00Z");
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
						messages: [assistantMessage("2026-06-03T09:00:30Z", { input: 7, cacheRead: 3, output: 2, total: 0.01 }, "anthropic", "claude-haiku-4.5")],
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

		const file = [
			JSON.stringify({ type: "session", version: 3, id: "s2", timestamp: "2026-06-03T08:00:00Z", cwd: "/repo" }),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-06-03T08:02:00Z",
				message: subagentToolResult("2026-06-03T08:02:00Z", details),
			}),
		].join("\n");

		writeSessionFile(root, "project/subagent-session.jsonl", file, now);
		const summary = await buildMonthlyUsageSummary({ sessionDir: root, now });

		expect(summary.days).toEqual([
			{ day: "2026-06-03", totals: { input: 18, cacheRead: 8, output: 6, cost: 0.03, chats: 1, subagentCalls: 2 } },
		]);
		expect(summary.dailyModels).toEqual([
			{
				day: "2026-06-03",
				models: [
					{
						provider: "anthropic",
						model: "claude-haiku-4.5",
						providerModel: "anthropic/claude-haiku-4.5",
						totals: { input: 7, cacheRead: 3, output: 2, cost: 0.01, chats: 1, subagentCalls: 2 },
					},
					{
						provider: "openai",
						model: "gpt-4o",
						providerModel: "openai/gpt-4o",
						totals: { input: 11, cacheRead: 5, output: 4, cost: 0.02, chats: 1, subagentCalls: 1 },
					},
				],
			},
		]);
		expect(summary.models).toEqual([
			{
				provider: "anthropic",
				model: "claude-haiku-4.5",
				providerModel: "anthropic/claude-haiku-4.5",
				totals: { input: 7, cacheRead: 3, output: 2, cost: 0.01, chats: 1, subagentCalls: 2 },
			},
			{
				provider: "openai",
				model: "gpt-4o",
				providerModel: "openai/gpt-4o",
				totals: { input: 11, cacheRead: 5, output: 4, cost: 0.02, chats: 1, subagentCalls: 1 },
			},
		]);

		rmSync(root, { recursive: true, force: true });
	});

	it("counts legacy subagent result snapshots", async () => {
		const root = makeTempDir();
		const now = new Date("2026-06-20T12:00:00Z");
		const legacyDetails = {
			mode: "parallel",
			agentScope: "user",
			projectAgentsDir: null,
			results: [
				{
					agent: "worker",
					agentSource: "user",
					task: "legacy",
					exitCode: 0,
					messages: [assistantMessage("2026-06-04T11:00:00Z", { input: 9, cacheRead: 2, output: 3, total: 0.04 })],
					stderr: "",
					usage: { input: 9, cacheRead: 2, cacheWrite: 0, output: 3, cost: 0.04, contextTokens: 14, turns: 1 },
				},
			],
		};
		const file = [
			JSON.stringify({ type: "session", version: 3, id: "s3", timestamp: "2026-06-04T11:00:00Z", cwd: "/repo" }),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-06-04T11:01:00Z",
				message: subagentToolResult("2026-06-04T11:01:00Z", legacyDetails),
			}),
		].join("\n");

		writeSessionFile(root, "project/legacy.jsonl", file, now);
		const summary = await buildMonthlyUsageSummary({ sessionDir: root, now });

		expect(summary.days).toEqual([
			{ day: "2026-06-04", totals: { input: 9, cacheRead: 2, output: 3, cost: 0.04, chats: 1, subagentCalls: 1 } },
		]);
		expect(summary.dailyModels).toEqual([
			{
				day: "2026-06-04",
				models: [
					{
						provider: "anthropic",
						model: "claude-sonnet-4.5",
						providerModel: "anthropic/claude-sonnet-4.5",
						totals: { input: 9, cacheRead: 2, output: 3, cost: 0.04, chats: 1, subagentCalls: 1 },
					},
				],
			},
		]);
		expect(summary.models).toEqual([
			{
				provider: "anthropic",
				model: "claude-sonnet-4.5",
				providerModel: "anthropic/claude-sonnet-4.5",
				totals: { input: 9, cacheRead: 2, output: 3, cost: 0.04, chats: 1, subagentCalls: 1 },
			},
		]);

		rmSync(root, { recursive: true, force: true });
	});

	it("renders stable report text", async () => {
		const root = makeTempDir();
		const now = new Date("2026-06-20T12:00:00Z");
		writeSessionFile(root, "project/empty.jsonl", JSON.stringify({ type: "session", version: 3, id: "s4", timestamp: "2026-06-01T00:00:00Z", cwd: "/repo" }), now);

		const summary = await buildMonthlyUsageSummary({ sessionDir: root, now });
		const report = formatMonthlyUsageReport(summary);
		const detailedReport = formatDetailedMonthlyUsageReport(summary);

		expect(report).toContain("June 2026 usage");
		expect(report).toContain("No usage recorded for 2026-06.");
		expect(report).toContain("Includes assistant turns plus nested subagent runs captured in session tool results.");
		expect(report).toContain("Chats = active session files that recorded usage that day.");
		expect(report).toContain("Chats");
		expect(report).toContain("Subcalls");
		expect(detailedReport).toContain("June 2026 usage by day");
		expect(detailedReport).toContain("Rows sorted by day.");
		expect(detailedReport).toContain("No usage recorded for 2026-06.");
		expect(detailedReport).toContain("Date");
		expect(detailedReport).toContain("Chats = active session files that recorded usage that day.");
		expect(detailedReport).toContain("Subcalls = subagent invocations captured that day.");

		rmSync(root, { recursive: true, force: true });
	});

	it("sorts detailed usage by provider/model", async () => {
		const root = makeTempDir();
		const now = new Date("2026-06-20T12:00:00Z");
		const file = [
			JSON.stringify({ type: "session", version: 3, id: "s5", timestamp: "2026-06-05T08:00:00Z", cwd: "/repo" }),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-06-05T10:00:00Z",
				message: assistantMessage("2026-06-05T10:00:00Z", { input: 10, cacheRead: 1, output: 2, total: 0.01 }, "openai", "gpt-4o"),
			}),
			JSON.stringify({
				type: "message",
				id: "m2",
				parentId: "m1",
				timestamp: "2026-06-05T11:00:00Z",
				message: assistantMessage("2026-06-05T11:00:00Z", { input: 20, cacheRead: 2, output: 3, total: 0.02 }, "anthropic", "claude-haiku-4.5"),
			}),
		].join("\n");

		writeSessionFile(root, "project/models.jsonl", file, now);
		const summary = await buildMonthlyUsageSummary({ sessionDir: root, now });

		expect(summary.models.map((item) => item.providerModel)).toEqual([
			"anthropic/claude-haiku-4.5",
			"openai/gpt-4o",
		]);

		const detailedReport = formatDetailedMonthlyUsageReport(summary);
		const anthropicIndex = detailedReport.indexOf("anthropic/claude-haiku-4.5");
		const openaiIndex = detailedReport.indexOf("openai/gpt-4o");
		expect(anthropicIndex).toBeGreaterThan(-1);
		expect(openaiIndex).toBeGreaterThan(-1);
		expect(anthropicIndex).toBeLessThan(openaiIndex);
		expect(detailedReport).toContain("2026-06-05 models");

		rmSync(root, { recursive: true, force: true });
	});
});
