import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { DEFAULT_TIMEOUT_SECONDS, normalizeControlParams, type NormalizedControlParams } from "./contracts.js";
import { runLifecycleTurn, type HerdrLifecyclePort, type LifecycleResult, type SessionHarvestPort } from "./lifecycle.js";
import { RunRegistry, type RunLeafHandle, type RunRootHandle } from "./run-registry.js";
import { validatePiSessionRef, materializeAndTrustSession, findTurnAnchor, harvestTurn, type TrustedMaterializedSession } from "./pi-session.js";

export type ControlClient = { getAgent(id: string): Promise<any>; processInfo(id: string): Promise<any>; sendAgentInput(id: string, text: string): Promise<any>; submitOwnedPane(id: string): Promise<any>; interruptOwnedPane(id: string): Promise<any>; closePane(id: string): Promise<any>; closeTab(id: string): Promise<any>; snapshot(): Promise<any>; dispose?(): void };
export type ControlDeps = {
 registry: RunRegistry; createClient: (socketPath: string) => ControlClient; preflight: () => Promise<{ socketPath: string }>; sessionRoot: string; now?: () => number;
 runLifecycle?: typeof runLifecycleTurn; lifecyclePort?: (client: ControlClient, paneId: string) => HerdrLifecyclePort; sessionPort?: (root: string) => SessionHarvestPort;
};
type State = "idle" | "working" | "blocked" | "done" | "unknown";
type ControlDetails = Record<string, any>;

/** Narrow retained-run controller. IDs are resolved exclusively through local registry handles. */
export function createHerdrSubagentControlRuntime(deps: ControlDeps) {
 const now = deps.now ?? Date.now;
 const wrap = (value: ControlDetails): AgentToolResult<ControlDetails> => ({ content: [{ type: "text", text: controlText(value) }], details: value });
 return { async execute(raw: unknown): Promise<AgentToolResult<ControlDetails>> {
  const input = normalizeControlParams(raw); const resolved = deps.registry.resolveControl(input.rootRunId, input.rootRunId, input.leafRunId);
  if (!resolved.ok) throw Object.assign(new Error(resolved.error.message), resolved.error);
  const root = resolved.root; const leaves = choose(root, input, eligible(input.action));
  if (!leaves.length) throw failure("unknown_or_foreign_run", "No uniquely eligible owned leaf.");
  if (input.action === "status") return wrap(result(input.action, root, leaves));
  const preflight = await deps.preflight(); const client = deps.createClient(preflight.socketPath);
  try {
   if (input.action === "steer") {
    const leaf = leaves[0]!; await live(client, leaf, false, deps.sessionRoot);
    await client.sendAgentInput(leaf.paneId, literal(input.message)); await client.submitOwnedPane(leaf.paneId);
    return wrap(result(input.action, root, leaves));
   }
   if (input.action === "follow_up") {
    if (!root.keepOpen) throw failure("unknown_or_foreign_run", "Default-close runs cannot accept a follow-up.");
    if (!deps.lifecyclePort || !deps.sessionPort) throw failure("agent_start_failed", "Control lifecycle ports are unavailable.");
    const leaf = leaves[0]!; const trusted = await live(client, leaf, true, deps.sessionRoot);
    const turnId = randomUUID(); const message = literal(input.message);
    const marker = JSON.stringify({ type: "herdr_subagent_task", rootRunId: root.rootRunId, leafRunId: leaf.leafRunId, turnId, task: message });
    // Claim before lifecycle delivery. A second controller sees working and cannot send.
    if (!deps.registry.claimFollowUp(root.rootRunId, leaf.leafRunId, turnId, marker)) throw failure("ambiguous_turn", "Follow-up leaf was claimed by another control request.");
    const life = await (deps.runLifecycle ?? runLifecycleTurn)(deps.lifecyclePort(client, leaf.paneId), deps.sessionPort(deps.sessionRoot), {
     agentId: leaf.paneId, task: marker, turnId, timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000, clock: { now }, sleeper: { sleep: async ms => await new Promise(resolve => setTimeout(resolve, ms)) }, retainedDone: trusted,
    });
    updateFollowUp(deps.registry, root.rootRunId, leaf.leafRunId, life);
    const updatedRoot = deps.registry.get(root.rootRunId)!; const updated = deps.registry.getLeaf(root.rootRunId, leaf.leafRunId)!;
    return wrap({ ...result(input.action, updatedRoot, [updated]), turnId, state: life.state, ...(life.result && !life.result.pending ? { finalOutput: life.result.output, stopReason: life.result.stopReason } : {}), ...(life.reason ? { reason: life.reason } : {}) });
   }
   if (input.action === "collect") return wrap(await collect(client, deps, root, leaves, input));
   if (input.action === "abort") {
    const leaf = leaves[0]!; await live(client, leaf, false, deps.sessionRoot); await client.interruptOwnedPane(leaf.paneId);
    await new Promise(resolve => setTimeout(resolve, Math.min((input.timeoutSeconds ?? 1) * 1000, 1000)));
    const warnings = await closeOwned(client, deps.registry, root, [leaf]);
    return wrap({ ...result(input.action, root, [leaf]), abortCandidateSent: true, gracefulAbortProven: false, warnings });
   }
   const warnings = await closeOwned(client, deps.registry, root, leaves);
   return wrap({ ...result(input.action, root, leaves), warnings });
  } finally { client.dispose?.(); }
 }};
}

function updateFollowUp(registry: RunRegistry, rootRunId: string, leafRunId: string, life: LifecycleResult) {
 const patch: any = { status: life.status, activeTurnId: undefined, activeMarker: undefined };
 if (life.result && !life.result.pending && life.session) patch.session = { source: "herdr:pi", path: life.session.path, sessionId: life.result.sessionId, anchorEntryId: life.result.anchorEntryId, finalEntryId: life.result.finalEntryId };
 registry.updateLeaf(rootRunId, leafRunId, patch);
 const root = registry.get(rootRunId); if (root && root.leaves.every(leaf => leaf.status !== "working" && leaf.status !== "booting" && leaf.status !== "queued")) registry.updateRoot(rootRunId, { status: life.status });
}
function eligible(action: NormalizedControlParams["action"]) { return (leaf: RunLeafHandle) => action === "status" ? true : action === "steer" ? leaf.status === "working" || leaf.status === "blocked" : action === "abort" ? leaf.status === "booting" || leaf.status === "working" || leaf.status === "blocked" : action === "follow_up" ? leaf.status === "succeeded" : action === "collect" ? leaf.status === "blocked" || leaf.status === "working" || leaf.status === "succeeded" : true; }
function choose(root: RunRootHandle, input: NormalizedControlParams, predicate: (leaf: RunLeafHandle) => boolean) { const candidates = input.leafRunId ? root.leaves.filter(x => x.leafRunId === input.leafRunId && (input.action === "status" || input.action === "close" || predicate(x))) : root.leaves.filter(predicate); if (input.leafRunId && candidates.length !== 1) throw failure("unknown_or_foreign_run", "Owned leaf is missing or ineligible."); if (!input.leafRunId && candidates.length !== 1 && input.action !== "status" && input.action !== "close") throw failure("ambiguous_turn", "Control requires an explicit leaf or one eligible leaf."); return candidates; }
function literal(text: string) { if (!text || /[\r\n]/.test(text)) throw failure("invalid_execution_mode", "message must be non-empty and newline-free."); return text; }
function failure(code: any, message: string) { return Object.assign(new Error(message), { code }); }
function result(action: string, root: RunRootHandle, leaves: RunLeafHandle[]) { return { action, rootRunId: root.rootRunId, status: root.status, tabId: root.tabId, leaves: leaves.map(x => ({ leafRunId: x.leafRunId, paneId: x.paneId, status: x.status, ...(x.session ? { session: x.session } : {}) })) }; }
function controlText(value: ControlDetails) { return value.finalOutput || `${value.action}: ${value.status}`; }
function state(raw: any): State { const v = raw?.agent?.agent_status ?? raw?.agent_status ?? raw?.agent?.state ?? raw?.state; return v === "idle" || v === "working" || v === "blocked" || v === "done" ? v : "unknown"; }
function agentPane(raw: any) { const agent = raw?.agent ?? raw; const value = agent?.pane_id ?? agent?.paneId; return typeof value === "string" ? value : undefined; }
function foregroundPi(raw: any) {
 const processes = raw?.process_info?.foreground_processes ?? raw?.result?.process_info?.foreground_processes;
 return Array.isArray(processes) && processes.some((process: any) => process && (process.name === "pi" || (Array.isArray(process.argv) && typeof process.argv[0] === "string" && basename(process.argv[0]) === "pi")));
}
async function live(client: ControlClient, leaf: RunLeafHandle, retained: boolean, root: string): Promise<TrustedMaterializedSession> {
 const agent = await client.getAgent(leaf.paneId); if (!agent || agent.exists === false || agentPane(agent) !== leaf.paneId) throw failure("pane_lost", "Owned pane disappeared or changed.");
 if (retained && state(agent) !== "idle" && state(agent) !== "done") throw failure("ambiguous_turn", "Retained leaf is not idle or done.");
 const process = await client.processInfo(leaf.paneId); if (!foregroundPi(process)) throw failure("pi_integration_missing", "Owned pane is not foreground Pi.");
 if (!retained) return {} as TrustedMaterializedSession;
 if (!leaf.session || leaf.session.source !== "herdr:pi" || !leaf.session.sessionId) throw failure("session_reference_missing", "Retained leaf has no trusted session identity.");
 const ref = await validatePiSessionRef(agent.agent ?? agent, root); if (ref.path !== leaf.session.path) throw failure("session_path_untrusted", "Retained session path changed.");
 const trusted = await materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }); if ((trusted as any).pending || trusted.sessionId !== leaf.session.sessionId) throw failure("session_path_untrusted", "Retained session identity changed.");
 return trusted;
}
async function collect(client: ControlClient, deps: ControlDeps, root: RunRootHandle, leaves: RunLeafHandle[], input: Extract<NormalizedControlParams, { action: "collect" }>) {
 const leaf = leaves[0]!; const agent = await client.getAgent(leaf.paneId); if (!agent || agent.exists === false || agentPane(agent) !== leaf.paneId) throw failure("pane_lost", "Owned pane disappeared or changed.");
 if (state(agent) === "blocked") return { ...result("collect", root, [leaf]), state: "blocked" };
 if (!leaf.activeTurnId || !leaf.activeMarker || (leaf.status !== "working" && leaf.status !== "blocked")) throw failure("result_unavailable", "No active turn retained for collection.");
 const ref = await validatePiSessionRef(agent.agent ?? agent, deps.sessionRoot); if (!leaf.session || ref.path !== leaf.session.path) throw failure("session_path_untrusted", "Retained session path changed.");
 const trusted = await materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }); if ((trusted as any).pending || trusted.sessionId !== leaf.session.sessionId) throw failure("session_path_untrusted", "Retained session identity changed.");
 const anchor = await findTurnAnchor(trusted, leaf.activeTurnId); if ((anchor as any).pending) return { ...result("collect", root, [leaf]), state: state(agent) };
 const harvested = await harvestTurn(trusted, leaf.activeTurnId, anchor as any, { state: state(agent) }); if ((harvested as any).pending) return { ...result("collect", root, [leaf]), state: state(agent) };
 const h: any = harvested; deps.registry.updateLeaf(root.rootRunId, leaf.leafRunId, { status: h.status, activeTurnId: undefined, activeMarker: undefined, session: { source: "herdr:pi", path: trusted.path, sessionId: h.sessionId, anchorEntryId: h.anchorEntryId, finalEntryId: h.finalEntryId } });
 deps.registry.updateRoot(root.rootRunId, { status: h.status });
 const updatedRoot = deps.registry.get(root.rootRunId)!; const updated = deps.registry.getLeaf(root.rootRunId, leaf.leafRunId)!; const output = { ...result("collect", updatedRoot, [updated]), finalOutput: h.output, stopReason: h.stopReason };
 if (input.closeAfterCollect) return { ...output, warnings: await closeOwned(client, deps.registry, root, [updated]) }; return output;
}
async function closeOwned(client: ControlClient, registry: RunRegistry, root: RunRootHandle, leaves: RunLeafHandle[]) {
 const warnings: string[] = []; const owned = new Set(root.leaves.map(x => x.paneId)); let foreign = true;
 try { foreign = tabPanes(await client.snapshot(), root.tabId).some(id => !owned.has(id)); } catch { warnings.push("WARNING: could not verify tab ownership; tab left open."); }
 for (const leaf of leaves) try { await client.closePane(leaf.paneId); registry.close(root.rootRunId, leaf.leafRunId); } catch { warnings.push(`WARNING: failed to close owned pane ${leaf.paneId}.`); }
 if (!foreign && !registry.get(root.rootRunId)?.leaves.length) try { const current = await client.snapshot(); if (tabPanes(current, root.tabId).some(id => !owned.has(id))) warnings.push("WARNING: foreign pane present; tab left open."); else if (tabExists(current, root.tabId)) await client.closeTab(root.tabId); } catch { warnings.push("WARNING: failed to close owned tab."); }
 else if (foreign) warnings.push("WARNING: foreign pane present; tab left open.");
 if (!registry.get(root.rootRunId)?.leaves.length) { try { await registry.release(root.rootRunId); } catch { warnings.push("WARNING: failed to release owned resources."); } registry.close(root.rootRunId); } return warnings;
}
function tabPanes(raw: any, tabId: string): string[] { const body = raw?.snapshot ?? raw?.result?.snapshot ?? raw; const panes = Array.isArray(body?.panes) ? body.panes : []; return panes.flatMap((pane: any) => (pane?.tab_id === tabId || pane?.tabId === tabId) && typeof (pane.pane_id ?? pane.paneId) === "string" ? [pane.pane_id ?? pane.paneId] : []); }
function tabExists(raw: any, tabId: string) { const body = raw?.snapshot ?? raw?.result?.snapshot ?? raw; return Array.isArray(body?.tabs) && body.tabs.some((tab: any) => tab?.tab_id === tabId || tab?.id === tabId); }
