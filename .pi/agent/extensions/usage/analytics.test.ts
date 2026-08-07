import { describe, expect, it } from "bun:test";
import { aggregate } from "./analytics.js";
import { usageTree } from "./tree.js";
import type { UsageEvent } from "./session-reader.js";

const range = { label: "test", startMs: 0, endMs: 10_000 };

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
	return {
		sessionId: "session-id-1234",
		sessionPath: "/sessions/session.jsonl",
		timestampMs: 1_000,
		project: "/repo",
		workflow: "ad-hoc",
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		input: 1,
		cacheRead: 0,
		cacheWrite: 0,
		output: 1,
		reasoning: 0,
		totalTokens: 2,
		cost: 1,
		agentKind: "main",
		agentName: "main",
		subagentDepth: 0,
		...overrides,
	};
}

describe("session display labels", () => {
	it("uses only the native session name, falling back to the session ID", () => {
		const named = event({ sessionTitle: "Route audit" });
		const unnamed = event({ sessionId: "session-id-5678" });

		expect(aggregate([named], [], range, "session")[0]).toMatchObject({ key: "session-id-1234", label: "Route audit" });
		expect(aggregate([unnamed], [], range, "session")[0]).toMatchObject({ key: "session-id-5678", label: "session-id-5678" });

		const tree = usageTree([named, unnamed], range.startMs, range.endMs, ["project", "session"]);
		expect(tree[0]?.children.map((node) => node.label).sort()).toEqual(["Route audit", "session-id-5678"]);
	});
});
