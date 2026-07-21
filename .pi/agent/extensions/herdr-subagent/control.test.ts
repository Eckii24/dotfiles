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
 return { registry, calls, runtime: createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions" }) };
}

async function retained(mutate?: (raw: any) => any | Promise<any>, waitForLifecycle?: Promise<void>) {
 const root = await realpath(await mkdtemp(join(tmpdir(), "herdr-control-"))); const sessionPath = join(root, "session.jsonl"); await writeFile(sessionPath, '{"type":"session","version":3,"id":"session"}\n');
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded", session: { source: "herdr:pi", path: sessionPath, sessionId: "session" } }] });
 registry.setFollowUpExpectations("root", "leaf", { agentName: "agent-name", sessionName: "session-name" });
 const base = () => ({ agent: { pane_id: "pane", agent_status: "done", name: "agent-name", env: { PI_HERDR_ROOT_RUN_ID: "root", PI_HERDR_LEAF_RUN_ID: "leaf" }, agent_session: { source: "herdr:pi", kind: "path", value: sessionPath, name: "session-name" } } });
 const calls: string[] = []; let lifecycleCalls = 0;
 const client: any = { getAgent: async () => mutate ? await mutate(base()) : base(), sendAgentInput: async (_: string, value: string) => calls.push(`send:${value}`), submitOwnedPane: async () => calls.push("enter"), interruptOwnedPane: async () => {}, closePane: async () => {}, closeTab: async () => {}, snapshot: async () => ({ snapshot: { panes: [] } }) };
 const runtime = createHerdrSubagentControlRuntime({ registry, createClient: () => client, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: root, lifecyclePort: () => ({}) as any, sessionPort: () => ({}) as any, runLifecycle: (async () => { lifecycleCalls++; await waitForLifecycle; return { status: "succeeded", state: "done", delivered: true, enterSent: true, session: { source: "herdr:pi", kind: "path", root, path: sessionPath, sessionId: "session", bytes: 1 }, result: { pending: false, status: "succeeded", output: "FINAL", stopReason: "stop", sessionId: "session", anchorEntryId: "anchor", finalEntryId: "final" } }; }) as any });
 return { root, registry, calls, runtime, get lifecycleCalls() { return lifecycleCalls; } };
}

test("status is local; active steer uses exact current agent pane", async () => {
 const f = basic(); const status = await f.runtime.execute({ action: "status", rootRunId: "root" }); expect(status.details.leaves[0].paneId).toBe("pane");
 await f.runtime.execute({ action: "steer", rootRunId: "root", message: "hello" }); expect(f.calls).toEqual(["send:hello", "enter"]);
 await expect(f.runtime.execute({ action: "steer", rootRunId: "root", message: "bad\ninput" })).rejects.toMatchObject({ code: "invalid_execution_mode" });
});

test("ambiguous, missing, and foreign controls fail closed", async () => {
 const f = basic([{ leafRunId: "one", paneId: "one", status: "working" }, { leafRunId: "two", paneId: "two", status: "blocked" }]);
 await expect(f.runtime.execute({ action: "steer", rootRunId: "root", message: "x" })).rejects.toMatchObject({ code: "ambiguous_turn" });
 await expect(f.runtime.execute({ action: "status", rootRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
 await expect(f.runtime.execute({ action: "abort", rootRunId: "root", leafRunId: "missing" })).rejects.toMatchObject({ code: "unknown_or_foreign_run" });
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
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); const f = await retained(undefined, gate);
 try {
  const first = f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "next" });
  for (let turn = 0; turn < 20 && f.registry.getLeaf("root", "leaf")?.status !== "working"; turn++) await Promise.resolve();
  await expect(f.runtime.execute({ action: "follow_up", rootRunId: "root", leafRunId: "leaf", message: "duplicate" })).rejects.toMatchObject({ code: "ambiguous_turn" }); expect(f.lifecycleCalls).toBe(1);
  release(); await first;
 } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("close re-snapshots and leaves a tab open when a foreign pane arrives", async () => {
 const registry = new RunRegistry(); registry.register({ rootRunId: "root", workspaceId: "work", tabId: "tab", tabLabel: "tab", status: "succeeded", keepOpen: true, leaves: [{ leafRunId: "leaf", paneId: "pane", status: "succeeded" }] });
 let snapshots = 0; const calls: string[] = [];
 const runtime = createHerdrSubagentControlRuntime({ registry, preflight: async () => ({ socketPath: "/socket" }), sessionRoot: "/sessions", createClient: () => ({ getAgent: async () => undefined, sendAgentInput: async () => {}, submitOwnedPane: async () => {}, interruptOwnedPane: async () => {}, closePane: async () => { calls.push("pane"); }, closeTab: async () => { calls.push("tab"); }, snapshot: async () => ++snapshots === 1 ? { snapshot: { panes: [{ pane_id: "pane", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } : { snapshot: { panes: [{ pane_id: "foreign", tab_id: "tab" }], tabs: [{ tab_id: "tab" }] } } }) });
 const result = await runtime.execute({ action: "close", rootRunId: "root" }); expect(calls).toEqual(["pane"]); expect(result.details.warnings).toContain("WARNING: foreign pane present; tab left open.");
});
