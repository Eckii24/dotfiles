import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionUsage } from "./session-reader.js";

describe("readSessionUsage", () => {
	it("uses message timestamps rather than file mtime and retains full usage buckets", async () => {
		const root = mkdtempSync(join(tmpdir(), "usage-reader-"));
		const path = join(root, "historic.jsonl");
		writeFileSync(path, [
			JSON.stringify({ type: "session", id: "s1", cwd: "/repo", timestamp: "2026-07-01T10:00:00Z" }),
			JSON.stringify({ type: "session_info", name: "Analytics test" }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:00:00Z", message: { role: "user", content: [{ type: "text", text: "/implement add analytics" }] } }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:01:00Z", message: { role: "assistant", provider: "openai", model: "gpt", usage: { input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 5, totalTokens: 15, cost: { total: 0.1 } } } }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:02:00Z", message: { role: "toolResult", toolName: "bash", isError: true } }),
		].join("\n"));
		utimesSync(path, new Date("2026-08-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z"));
		const result = await readSessionUsage(root);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({ sessionId: "s1", sessionTitle: "Analytics test", project: "/repo", workflow: "implement", input: 1, cacheRead: 2, cacheWrite: 3, output: 4, reasoning: 5, totalTokens: 15, cost: 0.1 });
		expect(result.toolEvents).toMatchObject([{ sessionId: "s1", isError: true }]);
		rmSync(root, { recursive: true, force: true });
	});

	it("classifies persisted Herdr child sessions from parent piSession references", async () => {
		const root = mkdtempSync(join(tmpdir(), "usage-reader-herdr-"));
		const childPath = join(root, "child.jsonl");
		writeFileSync(childPath, [
			JSON.stringify({ type: "session", id: "child-session", cwd: "/repo" }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:01:00Z", message: { role: "assistant", provider: "openai", model: "gpt", usage: { input: 20, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0, totalTokens: 21, cost: { total: 2 } } } }),
		].join("\n"));
		writeFileSync(join(root, "parent.jsonl"), [
			JSON.stringify({ type: "session", id: "parent-session", cwd: "/repo" }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:02:00Z", message: { role: "toolResult", toolName: "subagent", isError: false, details: { protocolVersion: 1, children: [{ agent: "worker", piSession: { source: "herdr:pi", kind: "path", path: childPath, sessionId: "child-session" } }] } } }),
		].join("\n"));
		const result = await readSessionUsage(root);
		expect(result.events).toHaveLength(1);
		expect(result.events[0]).toMatchObject({ sessionId: "child-session", threadId: "parent-session", agentKind: "subagent", agentName: "worker", subagentDepth: 1 });
		rmSync(root, { recursive: true, force: true });
	});

	it("recurses current subagent child messages once and applies final workflow to earlier assistant events", async () => {
		const root = mkdtempSync(join(tmpdir(), "usage-reader-nested-"));
		const path = join(root, "nested.jsonl");
		const assistant = (input: number, cost: number) => ({ role: "assistant", provider: "openai", model: "gpt", usage: { input, cacheRead: 0, cacheWrite: 0, output: 1, reasoning: 0, totalTokens: input + 1, cost: { total: cost } } });
		writeFileSync(path, [
			JSON.stringify({ type: "session", id: "s2", cwd: "/repo" }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:00:00Z", message: assistant(10, 1) }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:01:00Z", message: { role: "user", content: [{ type: "text", text: "/implement feature" }] } }),
			JSON.stringify({ type: "message", timestamp: "2026-07-17T10:02:00Z", message: { role: "toolResult", toolName: "subagent", isError: false, details: { run: { children: [{ agent: "worker", messages: [{ ...assistant(20, 2), timestamp: Date.parse("2026-07-17T10:02:30Z") }] }] } } } }),
		].join("\n"));
		const result = await readSessionUsage(root);
		expect(result.events.map((event) => event.input)).toEqual([10, 20]);
		expect(result.events.map((event) => event.agentName)).toEqual(["main", "worker"]);
		expect(result.events.every((event) => event.workflow === "implement")).toBe(true);
		expect(result.toolEvents.filter((event) => event.toolName === "subagent")).toHaveLength(1);
		rmSync(root, { recursive: true, force: true });
	});
});
