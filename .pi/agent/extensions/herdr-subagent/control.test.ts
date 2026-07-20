import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrSubagentControlRuntime } from "./control.js";
import { RunRegistry } from "./run-registry.js";

function fixture(leaves: any[] = [{ leafRunId: "leaf", paneId: "pane", status: "working" }]) {
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "working", keepOpen: true, leaves });
 const calls: string[] = []; const client: any = { getAgent: async () => ({ pane_id: "pane", agent_status: "working" }), processInfo: async () => ({ result: { process_info: { foreground_processes: [{ name: "pi", pid: 1 }] } } }), sendAgentInput: async (_: string, value: string) => calls.push(`send:${value}`), submitOwnedPane: async () => calls.push("enter"), interruptOwnedPane: async () => calls.push("interrupt"), closePane: async (id: string) => calls.push(`close:${id}`), closeTab: async () => calls.push("tab"), snapshot: async () => ({ snapshot: { panes: leaves.map(x => ({ pane_id: x.paneId, tab_id: "tab" })) } }) };
 return { registry, calls, runtime: createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions" }) };
}

test("status is AgentToolResult; steer selects only unique active owned leaf and sends one Enter", async () => {
 const f = fixture(); const status = await f.runtime.execute({ action: "status", rootRunId: "root" }); expect(status.details.leaves[0].paneId).toBe("pane"); expect(status.content).toEqual([{ type: "text", text: "status: working" }]); expect(f.calls).toEqual([]);
 await f.runtime.execute({ action: "steer", rootRunId: "root", message: "hello" }); expect(f.calls).toEqual(["send:hello", "enter"]);
 await expect(f.runtime.execute({ action: "steer", rootRunId: "root", message: "bad\ninput" })).rejects.toMatchObject({ code: "invalid_execution_mode" });
});
test("foreground Pi parser accepts HerdrClient-unwrapped and wrapped process info; rejects substrings", async () => {
 const f = fixture(); await f.runtime.execute({ action: "steer", rootRunId: "root", message: "wrapped" });
 const runtime = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ getAgent: async () => ({ pane_id: "pane", agent_status: "working" }), processInfo: async () => ({ process_info: { foreground_processes: [{ argv: ["/usr/bin/pi"], pid: 1 }] } }), sendAgentInput: async () => {}, submitOwnedPane: async () => {}, closePane: async () => {}, closeTab: async () => {}, snapshot: async () => ({}) }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions" });
 await expect(runtime.execute({ action: "steer", rootRunId: "root", message: "unwrapped" })).resolves.toBeDefined();
 const rejected = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ getAgent: async () => ({ pane_id: "pane", agent_status: "working" }), processInfo: async () => ({ process_info: { foreground_processes: [{ name: "not-pi", argv: ["/bin/pixel"] }] } }), sendAgentInput: async () => {}, submitOwnedPane: async () => {}, closePane: async () => {}, closeTab: async () => {}, snapshot: async () => ({}) }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions" });
 await expect(rejected.execute({ action: "steer", rootRunId: "root", message: "x" })).rejects.toMatchObject({ code: "pi_integration_missing" });
});
test("ambiguous, missing, and foreign controls fail closed", async () => {
 const f = fixture([{ leafRunId: "one", paneId: "one", status: "working" }, { leafRunId: "two", paneId: "two", status: "blocked" }]);
 await expect(f.runtime.execute({ action: "steer", rootRunId: "root", message: "x" })).rejects.toMatchObject({ code: "ambiguous_turn" });
 await expect(f.runtime.execute({ action: "status", rootRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
 await expect(f.runtime.execute({ action: "abort", rootRunId: "root", leafRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
});
test("abort accepts booting, working, and blocked owned leaves; reports candidate only", async () => {
 for (const status of ["booting", "working", "blocked"]) {
  const f = fixture([{ leafRunId: "leaf", paneId: "pane", status }]); const value = await f.runtime.execute({ action: "abort", rootRunId: "root", timeoutSeconds: 1 }); expect(value.details.gracefulAbortProven).toBe(false); expect(f.calls.filter(x => x === "interrupt")).toHaveLength(1); expect(f.calls).toContain("close:pane");
  const second = await f.runtime.execute({ action: "close", rootRunId: "root" }).catch(x => x); expect(second.code).toBe("unknown_or_foreign_run");
 }
});
test("follow_up uses same injected lifecycle port, waits native final, and retains trusted session", async () => {
 const root = await mkdtemp(join(tmpdir(), "herdr-control-")); const path = join(root, "session.jsonl"); await writeFile(path, '{"type":"session","version":3,"id":"session"}\n'); const trustedPath = await realpath(path);
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded", session: { source: "herdr:pi", path: trustedPath, sessionId: "session" } }] });
 const calls: string[] = []; const client: any = { getAgent: async () => ({ pane_id: "pane", agent_status: "done", agent_session: { source: "herdr:pi", kind: "path", value: trustedPath } }), processInfo: async () => ({ result: { process_info: { foreground_processes: [{ argv: ["/usr/bin/pi"], pid: 1 }] } } }), closePane: async () => {}, closeTab: async () => {}, snapshot: async () => ({ snapshot: { panes: [] } }), dispose: () => calls.push("dispose") };
 const port = { marker: "same-port" } as any; const sessions = { marker: "same-sessions" } as any; let release!: () => void, lifecycleStarted!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { lifecycleStarted = resolve; });
 const runtime = createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: root, lifecyclePort: value => { expect(value).toBe(client); return port; }, sessionPort: value => { expect(value).toBe(root); return sessions; }, runLifecycle: (async (actualPort, actualSessions, input) => { expect(actualPort).toBe(port); expect(actualSessions).toBe(sessions); expect(input.retainedDone?.sessionId).toBe("session"); expect(input).toMatchObject({ task: `next [herdr:task-sentinel:v1:${input.turnId}]`, marker: ` [herdr:task-sentinel:v1:${input.turnId}]` }); calls.push("lifecycle"); lifecycleStarted(); await gate; return { status: "succeeded", state: "done", delivered: true, enterSent: true, session: { source: "herdr:pi", kind: "path", root, path: trustedPath, sessionId: "session", bytes: 1 }, result: { pending: false, status: "succeeded", output: "FINAL", stopReason: "stop", sessionId: "session", anchorEntryId: "anchor", finalEntryId: "final" } }; }) as any });
 const first = runtime.execute({ action: "follow_up", rootRunId: "root", message: "next" });
 await started;
 const second = runtime.execute({ action: "follow_up", rootRunId: "root", message: "next" }).catch(error => error);
 const rejected = await second; release(); const value = await first;
 expect(calls.filter(call => call === "lifecycle")).toHaveLength(1); expect(rejected).toMatchObject({ code: "ambiguous_turn" }); expect(value.content).toEqual([{ type: "text", text: "FINAL" }]); expect(value.details).toMatchObject({ state: "done", finalOutput: "FINAL", leaves: [{ status: "succeeded", session: { path: trustedPath, sessionId: "session", finalEntryId: "final" } }] }); expect(registry.get("root")?.leaves).toHaveLength(1);
 await expect(runtime.execute({ action: "collect", rootRunId: "root" })).rejects.toMatchObject({ code: "result_unavailable" });
 await rm(root, { recursive: true, force: true });
});

test("control close re-snapshots and leaves a tab open when a foreign pane arrives", async () => {
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded" }] });
 let snapshots = 0; const calls: string[] = [];
 const runtime = createHerdrSubagentControlRuntime({ registry, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", createClient: () => ({ getAgent: async () => undefined, processInfo: async () => undefined, sendAgentInput: async () => {}, submitOwnedPane: async () => {}, interruptOwnedPane: async () => {}, closePane: async () => { calls.push("pane"); }, closeTab: async () => { calls.push("tab"); }, snapshot: async () => ++snapshots === 1 ? { snapshot: { panes: [{ pane_id: "pane", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } : { snapshot: { panes: [{ pane_id: "foreign", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } }) });
 const result = await runtime.execute({ action: "close", rootRunId: "root" });
 expect(calls).toEqual(["pane"]); expect(result.details.warnings).toContain("WARNING: foreign pane present; tab left open.");
});
