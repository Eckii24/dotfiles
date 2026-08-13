import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrSubagentControlRuntime } from "./control.js";
import { RunRegistry } from "./run-registry.js";

function active(paneId = "pane", state = "done", session?: any) {
 return { agent: { pane_id: paneId, agent_status: state, ...(session ? { agent_session: session } : {}) } };
}
function basic(leaves: any[] = [{ leafRunId: "leaf", paneId: "pane", status: "working" }]) {
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "working", keepOpen: true, leaves });
 const calls: string[] = []; const client: any = { getAgent: async (id: string) => active(id, "working"), sendAgentInput: async (_: string, value: string) => calls.push(`send:${value}`), submitOwnedPane: async () => calls.push("enter"), interruptOwnedPane: async () => calls.push("interrupt"), closePane: async (id: string) => calls.push(`close:${id}`), closeTab: async () => calls.push("tab"), snapshot: async () => ({ snapshot: { panes: leaves.map(x => ({ pane_id: x.paneId, tab_id: "tab" })) } }) };
 return { registry, calls, client, runtime: createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions" }) };
}

async function retained(mutate?: (raw: any) => any | Promise<any>, waitForLifecycle?: Promise<void>, onLifecycleEntry?: () => void, lifecycleResult?: any) {
 const root = await realpath(await mkdtemp(join(tmpdir(), "herdr-control-"))); const sessionPath = join(root, "session.jsonl"); await writeFile(sessionPath, '{"type":"session","version":3,"id":"session"}\n');
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded", session: { source: "herdr:pi", path: sessionPath, sessionId: "session" } }] });
 registry.setFollowUpExpectations("root", "leaf", { agentName: "agent-name", sessionName: "session-name" });
 const base = () => ({ agent: { pane_id: "pane", agent_status: "done", name: "agent-name", env: { PI_HERDR_ROOT_RUN_ID: "root", PI_HERDR_LEAF_RUN_ID: "leaf" }, agent_session: { source: "herdr:pi", kind: "path", value: sessionPath, name: "session-name" } } });
 const calls: string[] = []; let lifecycleCalls = 0;
 const client: any = { getAgent: async () => mutate ? await mutate(base()) : base(), sendAgentInput: async (_: string, value: string) => calls.push(`send:${value}`), submitOwnedPane: async () => calls.push("enter"), interruptOwnedPane: async () => {}, closePane: async () => {}, closeTab: async () => {}, snapshot: async () => ({ snapshot: { panes: [] } }) };
 const runtime = createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: root, lifecyclePort: () => ({}) as any, sessionPort: () => ({}) as any, runLifecycle: (async () => { lifecycleCalls++; onLifecycleEntry?.(); await waitForLifecycle; return lifecycleResult ?? { status: "succeeded", state: "done", delivered: true, enterSent: true, session: { source: "herdr:pi", kind: "path", root, path: sessionPath, sessionId: "session", bytes: 1 }, result: { pending: false, status: "succeeded", output: "FINAL", stopReason: "stop", sessionId: "session", anchorEntryId: "anchor", finalEntryId: "final" } }; }) as any });
 return { root, registry, calls, runtime, get lifecycleCalls() { return lifecycleCalls; } };
}

test("status is local; active steer uses exact current agent pane", async () => {
 const f = basic(); const status = await f.runtime.execute({ action: "status", rootRunId: "root" }); expect(status.details.leaves[0].paneId).toBe("pane");
 await f.runtime.execute({ action: "steer", rootRunId: "root", message: "hello" }); expect(f.calls).toEqual(["send:hello", "enter"]);
 await f.runtime.execute({ action: "steer", rootRunId: "root", message: "bad\ninput" }); expect(f.calls).toEqual(["send:hello", "enter", "send:bad input", "enter"]);
});

test("ambiguous, missing, and foreign controls fail closed", async () => {
 const f = basic([{ leafRunId: "one", paneId: "one", status: "working" }, { leafRunId: "two", paneId: "two", status: "blocked" }]);
 await expect(f.runtime.execute({ action: "steer", rootRunId: "root", message: "x" })).rejects.toMatchObject({ code: "ambiguous_turn" });
 await expect(f.runtime.execute({ action: "status", rootRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
 await expect(f.runtime.execute({ action: "abort", rootRunId: "root", leafRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
});

test("abort bounds Ctrl-C interrupt plus grace to about one second even when the RPC never resolves", async () => {
 let interruptCalled = false;
 const f = basic();
 f.client.interruptOwnedPane = async () => { interruptCalled = true; return new Promise(() => {}); };
 const started = Date.now();
 const value = await f.runtime.execute({ action: "abort", rootRunId: "root" });
 const elapsed = Date.now() - started;
 expect(interruptCalled).toBe(true);
 expect(value.details).toMatchObject({ abortCandidateSent: true, gracefulAbortProven: false });
 expect(elapsed).toBeGreaterThanOrEqual(900); expect(elapsed).toBeLessThan(1400);
});

test("follow_up uses authoritative current agent/session, retains leaf, and supports serial native finals", async () => {
 const f = await retained();
 try {
  const one = await f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" });
  const two = await f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "again" });
  expect(one.content).toEqual([{ type: "text", text: "FINAL" }]); expect(two.details.finalOutput).toBe("FINAL"); expect(f.lifecycleCalls).toBe(2);
  expect(f.registry.getLeaf("root", "leaf")).toMatchObject({ status: "succeeded", session: { sessionId: "session", finalEntryId: "final" } });
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("follow_up authoritative proof negatives deliver no input", async () => {
 const cases: Array<[string, (raw: any) => any | Promise<any>, string]> = [
  ["agent error", async () => { throw new Error("unavailable"); }, "pi_integration_missing"],
  ["missing agent", () => undefined, "pane_lost"],
  ["malformed agent", () => ({ agent: "bad" }), "pane_lost"],
  ["pane mismatch", raw => ({ ...raw, agent: { ...raw.agent, pane_id: "other" } }), "pane_lost"],
  ["non idle done", raw => ({ ...raw, agent: { ...raw.agent, agent_status: "working" } }), "ambiguous_turn"],
  ["root metadata mismatch", raw => ({ ...raw, agent: { ...raw.agent, env: { ...raw.agent.env, PI_HERDR_ROOT_RUN_ID: "other" } } }), "pi_integration_missing"],
  ["leaf metadata malformed", raw => ({ ...raw, agent: { ...raw.agent, env: { ...raw.agent.env, PI_HERDR_LEAF_RUN_ID: 1 } } }), "pi_integration_missing"],
  ["agent name mismatch", raw => ({ ...raw, agent: { ...raw.agent, name: "other" } }), "pi_integration_missing"],
  ["session name mismatch", raw => ({ ...raw, agent: { ...raw.agent, agent_session: { ...raw.agent.agent_session, name: "other" } } }), "pi_integration_missing"],
  ["wrong session source", raw => ({ ...raw, agent: { ...raw.agent, agent_session: { ...raw.agent.agent_session, source: "other" } } }), "session_reference_missing"],
  ["missing session", raw => ({ ...raw, agent: { ...raw.agent, agent_session: undefined } }), "session_reference_missing"],
  ["session path mismatch", raw => ({ ...raw, agent: { ...raw.agent, agent_session: { ...raw.agent.agent_session, value: "/tmp/other.jsonl" } } }), "session_path_untrusted"],
  ["session ID mismatch", async raw => { await writeFile(raw.agent.agent_session.value, '{"type":"session","version":3,"id":"other"}\n'); return raw; }, "session_path_untrusted"],
 ];
 for (const [_label, mutate, code] of cases) {
  const f = await retained(mutate);
  try { await expect(f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" })).rejects.toMatchObject({ code }); expect(f.lifecycleCalls).toBe(0); expect(f.calls).toEqual([]); }
  finally { await rm(f.root, { recursive: true, force: true }); }
 }
});

test("atomic follow_up claim rejects concurrent delivery", async () => {
 let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const lifecycleEntered = new Promise<void>(resolve => { entered = resolve; }); const f = await retained(undefined, gate, entered);
 try {
  const first = f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" });
  await lifecycleEntered;
  await expect(f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "duplicate" })).rejects.toMatchObject({ code: "ambiguous_turn" }); expect(f.lifecycleCalls).toBe(1);
  release(); await first;
 } finally { release(); await rm(f.root, { recursive: true, force: true }); }
});

test("follow_up reports a structured failure instead of crashing when the run is closed mid-turn", async () => {
 let release!: () => void; let entered!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const lifecycleEntered = new Promise<void>(resolve => { entered = resolve; }); const f = await retained(undefined, gate, entered);
 try {
  const exec = f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" });
  await lifecycleEntered;
  f.registry.close("root"); // simulate a concurrent close/shutdown deleting the retained run mid-turn
  release();
  await expect(exec).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
 } finally { release(); await rm(f.root, { recursive: true, force: true }); }
});

test("delivered blocked follow_up retains turn marker for later collect", async () => {
 const f = await retained(undefined, undefined, undefined, { status: "blocked", state: "blocked", delivered: true, enterSent: true, reason: "confirm" });
 try {
  const value = await f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" });
  expect(value.details).toMatchObject({ state: "blocked" }); expect(f.registry.getLeaf("root", "leaf")).toMatchObject({ status: "blocked", activeTurnId: expect.any(String), activeMarker: expect.stringContaining("herdr:task-sentinel") });
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("collect returns persisted trusted sibling final without re-harvesting marker", async () => {
 const f = basic([{ leafRunId: "blocked", paneId: "blocked-pane", status: "blocked" }, { leafRunId: "sibling", paneId: "pane", status: "succeeded", terminal: { status: "succeeded", output: "background final", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" } }]);
 f.registry.updateRoot("root", { status: "blocked" });
 const value = await f.runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "sibling" });
 expect(value.details).toMatchObject({ finalOutput: "background final", stopReason: "stop" }); expect(value.content[0]?.text).toBe("background final");
});

test("collect waits for deferred parallel sibling lifecycle to persist its terminal", async () => {
 const f = basic([{ leafRunId: "blocked", paneId: "blocked-pane", status: "blocked" }, { leafRunId: "sibling", paneId: "pane", status: "working", activeTurnId: "turn" }]); f.registry.updateRoot("root", { status: "blocked" }); let sleeps = 0;
 const runtime = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ ...f.client, getAgent: async () => { throw new Error("must wait for registry terminal"); } }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", now: () => 0, sleeper: { sleep: async () => { if (++sleeps === 1) f.registry.updateLeaf("root", "sibling", { status: "succeeded", activeTurnId: undefined, activeMarker: undefined, terminal: { status: "succeeded", output: "deferred final", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" } }); } } });
 const updates: any[] = []; const value = await runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "sibling", timeoutSeconds: 1 }, undefined, update => updates.push(update));
 expect(value.details).toMatchObject({ terminalStatus: "succeeded", finalOutput: "deferred final" }); expect(sleeps).toBe(1); expect(updates).toHaveLength(1);
});

test("collect accepts every persisted terminal status and closes after persisted collection", async () => {
 for (const status of ["succeeded", "failed", "aborted", "timed_out", "lost"] as const) {
  const f = basic([{ leafRunId: "leaf", paneId: "pane", status, terminal: { status, output: "saved", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" } }]); f.registry.updateRoot("root", { status: status === "succeeded" ? "succeeded" : "failed" });
  const value = await f.runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "leaf", closeAfterCollect: true });
  expect(value.details).toMatchObject({ terminalStatus: status }); expect(f.calls).toContain("close:pane"); expect(f.registry.get("root")).toBeUndefined();
 }
});

test("collect accepts terminal lifecycle status without fabricating a trusted final", async () => {
 for (const status of ["succeeded", "failed", "aborted", "timed_out", "lost"] as const) {
  const f = basic([{ leafRunId: "leaf", paneId: "pane", status }]); f.registry.updateRoot("root", { status: status === "succeeded" ? "succeeded" : status });
  f.client.getAgent = async () => { throw new Error("terminal collection must not query live pane"); };
  const value = await f.runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "leaf" });
  expect(value.details).toMatchObject({ terminalStatus: status }); expect(value.details.finalOutput).toBeUndefined();
 }
});

test("collect reconciles a timed-out turn with a late trusted native final", async () => {
 const sessionRoot = join(import.meta.dir, "test-fixtures/sessions"); const sessionPath = join(sessionRoot, "minimal-normal.jsonl");
 const f = basic([{ leafRunId: "leaf", paneId: "pane", status: "timed_out", activeTurnId: "TURN_NORMAL", activeMarker: " [herdr:task-sentinel:v1:TURN_NORMAL]" }]); f.registry.updateRoot("root", { status: "timed_out" });
 const runtime = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ ...f.client, getAgent: async () => active("pane", "done", { source: "herdr:pi", kind: "path", value: sessionPath }) }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot });
 const value = await runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "leaf" });
 expect(value.details).toMatchObject({ terminalStatus: "succeeded", finalOutput: "done", stopReason: "stop" });
 expect(f.registry.getLeaf("root", "leaf")).toMatchObject({ status: "succeeded", activeTurnId: undefined, activeMarker: undefined, terminal: { finalEntryId: "final" } });
});

test("collect fixed clock times out, suppresses duplicate updates, and observes abort", async () => {
 const f = basic([{ leafRunId: "leaf", paneId: "pane", status: "blocked" }]); let sleeps = 0; const runtime = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ ...(f as any).client, getAgent: async () => active("pane", "blocked") }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", now: () => 0, sleeper: { sleep: async () => { sleeps++; } } });
 const updates: any[] = []; const value = await runtime.execute({ action: "collect", rootRunId: "root", timeoutSeconds: 1 }, undefined, update => updates.push(update)); expect(value.details).toMatchObject({ pending: true, state: "blocked" }); expect(sleeps).toBe(4); expect(updates).toHaveLength(1);
 const controller = new AbortController(); controller.abort(); await expect(runtime.execute({ action: "collect", rootRunId: "root" }, controller.signal)).rejects.toMatchObject({ code: "child_aborted" });
});

test("collect reports a structured failure instead of crashing when the run closes mid-poll", async () => {
 const f = basic([{ leafRunId: "leaf", paneId: "pane", status: "blocked" }]);
 const runtime = createHerdrSubagentControlRuntime({ registry: f.registry, createClient: () => ({ ...(f as any).client, getAgent: async () => active("pane", "blocked") }), preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", now: () => 0, sleeper: { sleep: async () => { f.registry.close("root"); } } });
 await expect(runtime.execute({ action: "collect", rootRunId: "root", leafRunId: "leaf", timeoutSeconds: 1 })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
});

test("close re-snapshots and leaves a tab open when a foreign pane arrives", async () => {
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded" }] });
 let snapshots = 0; const calls: string[] = [];
 const runtime = createHerdrSubagentControlRuntime({ registry, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", createClient: () => ({ getAgent: async () => undefined, sendAgentInput: async () => {}, submitOwnedPane: async () => {}, interruptOwnedPane: async () => {}, closePane: async () => { calls.push("pane"); }, closeTab: async () => { calls.push("tab"); }, snapshot: async () => ++snapshots === 1 ? { snapshot: { panes: [{ pane_id: "pane", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } : { snapshot: { panes: [{ pane_id: "foreign", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } }) });
 const result = await runtime.execute({ action: "close", rootRunId: "root" }); expect(calls).toEqual(["pane"]); expect(result.details.warnings).toContain("WARNING: foreign pane present; tab left open.");
});
