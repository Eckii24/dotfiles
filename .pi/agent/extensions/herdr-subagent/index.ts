import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CapacityCoordinator, isDeclaredWriter } from "./capacity.js";
import { discoverAgentProfiles, projectProfilesRequiringConfirmation, type AgentProfile } from "./agent-profiles.js";
import { HerdrSubagentParamsSchema, HerdrSubagentControlParamsSchema, ContractValidationError, createRunIds, makeError, normalizeSubagentParams, type ErrorCode, type HerdrLeafResult, type HerdrSubagentResult, type NormalizedItem } from "./contracts.js";
import { HerdrClient } from "./herdr-client.js";
import { runLifecycleTurn, type AgentSnapshot, type HerdrLifecyclePort, type LifecycleResult, type SessionHarvestPort } from "./lifecycle.js";
import { createPiLaunchDescriptor, type PiLaunchDescriptor } from "./pi-launch.js";
import { findTurnAnchor, harvestTurn, materializeAndTrustSession, recordAbsentSessionBaseline, validatePiSessionRef, type SessionBaseline } from "./pi-session.js";
import { checkPreconditions, MAX_NESTING_DEPTH, PreconditionsError, type PreconditionsContext } from "./preconditions.js";
import { RunRegistry } from "./run-registry.js";
import { acceptLeaf, addTopologyLeaf, cleanupTopology, createTopology, type TopologyResult } from "./topology.js";
import { formatResult } from "./result-format.js";
import { renderSubagentCall, renderSubagentResult } from "./subagent-render.js";
import { createHerdrSubagentControlRuntime } from "./control.js";
import { createTaskDelivery } from "./task-delivery.js";

const sessionRoot = join(homedir(), ".pi", "agent", "sessions");
type ToolUpdate = (value: any) => void;
type RuntimeContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;
type Client = HerdrClient & Record<string, any>;
export type HerdrRuntimeDependencies = {
	preflight?: () => Promise<PreconditionsContext>; discover?: typeof discoverAgentProfiles; createClient?: (socketPath: string) => Client;
	createCapacity?: (client: Client) => any; createLaunch?: (input: any) => Promise<PiLaunchDescriptor>; createTopology?: typeof createTopology;
	addTopologyLeaf?: typeof addTopologyLeaf; cleanupTopology?: typeof cleanupTopology; acceptLeaf?: typeof acceptLeaf;
	runLifecycle?: typeof runLifecycleTurn; ids?: () => { rootRunId: string; leafRunId: string; turnId: string }; now?: () => number;
	sessionRoot?: string; registry?: RunRegistry;
};
export class HerdrSetupError extends Error { constructor(readonly code: ErrorCode, message: string) { super(message); this.name = "HerdrSetupError"; } }
type PreparedLeaf = { item: NormalizedItem; profile: any; cwd: string; ids: { leafRunId: string; turnId: string }; lease: any; launch: PiLaunchDescriptor; leaf: HerdrLeafResult; life?: LifecycleResult };

/** Single, parallel, and chain share validation/preflight, but chain starts topology leaves only after success. */
export function createHerdrSubagentRuntime(deps: HerdrRuntimeDependencies = {}) {
	const registry = deps.registry ?? new RunRegistry(); const now = deps.now ?? Date.now;
	const discover = deps.discover ?? discoverAgentProfiles; const createClient = deps.createClient ?? (path => new HerdrClient({ socketPath: path }) as Client);
	return { registry, async execute(raw: unknown, ctx: RuntimeContext, signal?: AbortSignal, onUpdate?: ToolUpdate): Promise<any> {
		let topology: TopologyResult | undefined; let client: Client | undefined; let capacity: any; let prepared: PreparedLeaf[] = []; let deferClientDispose = false;
		try {
			const input = normalizeSubagentParams(raw);
			const preflight = await (deps.preflight ?? checkPreconditions)();
			if (preflight.nestingDepth >= MAX_NESTING_DEPTH) throw new PreconditionsError("nesting_depth_exceeded", `Pi child nesting may not exceed ${MAX_NESTING_DEPTH}.`);
			const items: NormalizedItem[] = input.mode === "single" ? [{ name: input.agent!, agent: input.agent!, task: input.task!, cwd: input.cwd, inputIndex: 0 }] : input.items!;
			const profiles = discover(ctx.cwd, input.agentScope);
			prepared = await Promise.all(items.map(async (item, index) => {
				const profile = profiles.agents.find(agent => agent.name === item.agent);
				if (!profile) throw new HerdrSetupError("agent_profile_not_found", `Agent profile ${item.agent} was not found in ${input.agentScope} scope.`);
				const id = index === 0 ? (deps.ids ?? createRunIds)() : createRunIds();
				const cwd = await canonicalCwd(item.cwd ?? ctx.cwd);
				return { item, profile, cwd, ids: { leafRunId: id.leafRunId, turnId: id.turnId } } as Omit<PreparedLeaf, "lease" | "launch" | "leaf">;
			}));
			const requestedProject = projectProfilesRequiringConfirmation(profiles.agents, prepared.map(x => x.profile.name));
			if (input.mode === "parallel") {
				const writerCwds = new Set<string>();
				for (const entry of prepared) if (isDeclaredWriter(entry.profile.tools)) {
					if (writerCwds.has(entry.cwd) && !input.allowSharedWorkspaceWrites) throw new HerdrSetupError("shared_workspace_write_conflict", "Parallel declared writers require distinct canonical cwd values.");
					writerCwds.add(entry.cwd);
				}
			}
			if (requestedProject.length && input.confirmProjectAgents && ctx.hasUI && !(await ctx.ui.confirm("Run project-local Herdr agent?", `Agents: ${requestedProject.map(profile => profile.name).join(", ")}\nSource: ${profiles.projectAgentsDir ?? "project"}`))) throw new HerdrSetupError("project_agent_not_confirmed", "Project-local agent was not approved.");
			const ids = (deps.ids ?? createRunIds)();
			// Replace provisional first leaf IDs: root ID is deliberately common, leaf/turn remain per item.
			prepared[0]!.ids = { leafRunId: ids.leafRunId, turnId: ids.turnId };
			client = createClient(preflight.socketPath); capacity = deps.createCapacity?.(client) ?? new CapacityCoordinator({ snapshot: () => client!.snapshot() });
			for (const entry of prepared) {
				entry.lease = await capacity.acquireWriteLease({ cwd: entry.cwd, rootRunId: ids.rootRunId, tools: entry.profile.tools, allowSharedWorkspaceWrites: input.allowSharedWorkspaceWrites });
				entry.launch = await (deps.createLaunch ?? createPiLaunchDescriptor)({ piExecutable: preflight.piExecutable, cwd: entry.cwd, profile: entry.profile, rootRunId: ids.rootRunId, leafRunId: entry.ids.leafRunId, parentRootRunId: preflight.parentRootRunId, nestingDepth: preflight.nestingDepth, group: input.group });
				entry.leaf = { leafRunId: entry.ids.leafRunId, name: entry.item.name, agent: entry.profile.name, cwd: entry.cwd, paneId: "", paneLabel: "", status: "queued" };
			}
			const first = prepared[0]!;
			topology = await (deps.createTopology ?? createTopology)({ client, capacity, workspaceId: preflight.workspaceId, rootRunId: ids.rootRunId, group: input.group, paneCount: prepared.length, leaves: input.mode === "chain" ? [{ leafRunId: first.ids.leafRunId, launch: first.launch, lease: first.lease }] : prepared.map(x => ({ leafRunId: x.ids.leafRunId, launch: x.launch, lease: x.lease })) });
			const paneIds = [...topology.group.ownedPaneIds];
			for (const [index, entry] of prepared.entries()) if (input.mode !== "chain" || index === 0) { entry.leaf.paneId = paneIds.shift()!; entry.leaf.paneLabel = entry.launch.name; entry.leaf.status = "booting"; }
			registry.register({ rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, status: "working", keepOpen: input.keepOpen, leaves: prepared.map(x => ({ leafRunId: x.ids.leafRunId, paneId: x.leaf.paneId, status: x.leaf.status, activeTurnId: x.ids.turnId })) });
			registry.setRelease(ids.rootRunId, async () => { for (const lease of topology!.leases.values()) await capacity.releaseWriteLease(lease); topology!.leases.clear(); await capacity.releaseGroup(topology!.reservation); });
			const startedAt = now();
			const run = async (entry: PreparedLeaf, previous?: string): Promise<LifecycleResult> => {
				const task = input.mode === "chain" ? entry.item.task.replaceAll("{previous}", previous ?? "") : entry.item.task;
				const delivery = createTaskDelivery(task, entry.ids.turnId);
				let life: LifecycleResult;
				try { life = await (deps.runLifecycle ?? runLifecycleTurn)(lifecyclePort(client!, entry.leaf.paneId), sessionPort(deps.sessionRoot ?? sessionRoot), { agentId: entry.leaf.paneId, task: delivery.prompt, marker: delivery.marker, turnId: entry.ids.turnId, timeoutMs: input.timeoutSeconds * 1000, clock: { now }, sleeper: { sleep: async ms => await new Promise(resolve => setTimeout(resolve, ms)) }, signal, onReady: async () => { await entry.launch.cleanupAfterReady(); entry.leaf.status = "working"; registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: "working" }); } }); }
				catch (error) { if (!(error instanceof Error) || !/(?:pane|agent)_not_found/.test(error.message)) throw error; life = { status: "lost", delivered: true, enterSent: true, state: "unknown", reason: "Owned pane disappeared." }; }
				entry.life = life; applyLife(entry.leaf, life); if (life.delivered) (deps.acceptLeaf ?? acceptLeaf)(topology!.group, entry.ids.leafRunId);
				// A permission-blocked delivered turn remains collectable after a fixed human resolution.
				const active = life.status === "blocked" && life.delivered;
				registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: entry.leaf.status, activeTurnId: active ? entry.ids.turnId : undefined, activeMarker: active ? delivery.marker : undefined, ...(entry.leaf.piSession ? { session: { source: "herdr:pi", path: entry.leaf.piSession.path, sessionId: entry.leaf.piSession.sessionId } } : {}) });
				return life;
			};
			if (input.mode === "parallel") {
				const safeRun = async (entry: PreparedLeaf): Promise<LifecycleResult> => {
					try { return await run(entry); }
					catch (error) {
						const life: LifecycleResult = { status: "failed", delivered: false, enterSent: false, state: "unknown", reason: error instanceof Error ? error.message : "Child lifecycle failed." };
						entry.life = life; applyLife(entry.leaf, life);
						registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: entry.leaf.status });
						return life;
					}
				};
				for (const entry of prepared) { entry.leaf.status = "working"; registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: "working" }); }
				const runs = prepared.map(entry => Promise.resolve().then(async () => ({ entry, life: await safeRun(entry) })));
				const pending = new Set(runs);
				let blocked = false;
				while (pending.size) {
					const next = await Promise.race(pending); pending.delete(runs[prepared.indexOf(next.entry)]!);
					if (next.life.status === "blocked") { blocked = true; break; }
				}
				if (blocked) {
					registry.updateRoot(ids.rootRunId, { status: "blocked" });
					const result: HerdrSubagentResult = { protocolVersion: 1, rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), nestingDepth: preflight.nestingDepth + 1, group: input.group, mode: input.mode, status: "blocked", workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, keepOpen: input.keepOpen, startedAt, finishedAt: now(), children: prepared.map(x => x.leaf), warnings: [...topology.warnings, ...prepared.flatMap(x => x.lease.warning ? [x.lease.warning] : [])] };
					const backgroundClient = client; deferClientDispose = true;
					void Promise.all(runs).then(async () => {
						for (const entry of prepared) {
							if (!entry.life?.delivered) await entry.launch.cleanupAfterFailure().catch(() => undefined);
							const lease = topology!.leases.get(entry.ids.leafRunId);
							if (lease) { await capacity.releaseWriteLease(lease).catch(() => undefined); topology!.leases.delete(entry.ids.leafRunId); }
						}
					}).catch(() => undefined).finally(() => { try { backgroundClient?.dispose(); } catch {} });
					const formatted = formatResult(result); onUpdate?.(formatted); return formatted;
				}
				await Promise.all(runs);
			}
			else {
				let previous = "";
				for (const [index, entry] of prepared.entries()) {
					if (index) { if (isDeclaredWriter(entry.profile.tools)) entry.lease = await capacity.acquireWriteLease({ cwd: entry.cwd, rootRunId: ids.rootRunId, tools: entry.profile.tools, allowSharedWorkspaceWrites: input.allowSharedWorkspaceWrites }); const paneId = await (deps.addTopologyLeaf ?? addTopologyLeaf)({ client, capacity, result: topology, leaf: { leafRunId: entry.ids.leafRunId, launch: entry.launch, lease: entry.lease } }); entry.leaf.paneId = paneId; entry.leaf.paneLabel = entry.launch.name; entry.leaf.status = "booting"; registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { paneId, status: "booting" }); }
					const life = await run(entry, previous); if (life.status !== "succeeded") break;
					previous = entry.leaf.finalOutput ?? "";
					const lease = topology.leases.get(entry.ids.leafRunId); if (lease) { await capacity.releaseWriteLease(lease); topology.leases.delete(entry.ids.leafRunId); }
				}
			}
			for (const entry of prepared) if (!entry.life || !entry.life.delivered) await entry.launch.cleanupAfterFailure().catch(() => undefined);
			// Chain preflight obtains all leases before side effects; never leave an unstarted step's provisional lease behind.
			if (input.mode === "chain") for (const entry of prepared) if (entry.lease.acquired && !topology.leases.has(entry.ids.leafRunId)) await capacity.releaseWriteLease(entry.lease).catch(() => undefined);
			const completed = prepared.filter(x => x.life).map(x => x.life!);
			const status = completed.some(x => x.status === "blocked") ? "blocked" : completed.some(x => x.status === "timed_out") ? "timed_out" : completed.some(x => x.status === "aborted") ? "aborted" : completed.some(x => x.status !== "succeeded") ? "failed" : "succeeded";
			registry.updateRoot(ids.rootRunId, { status });
			const result: HerdrSubagentResult = { protocolVersion: 1, rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), nestingDepth: preflight.nestingDepth + 1, group: input.group, mode: input.mode, status, workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, keepOpen: input.keepOpen, startedAt, finishedAt: now(), children: prepared.map(x => x.leaf), warnings: [...topology.warnings, ...(input.mode === "parallel" && input.allowSharedWorkspaceWrites && prepared.filter(x => isDeclaredWriter(x.profile.tools)).length > new Set(prepared.filter(x => isDeclaredWriter(x.profile.tools)).map(x => x.cwd)).size ? ["WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict."] : []), ...prepared.flatMap(x => x.lease.warning ? [x.lease.warning] : [])] };
			if (!input.keepOpen && status !== "blocked") { result.warnings.push(...await (deps.cleanupTopology ?? cleanupTopology)({ client, capacity, result: topology })); registry.close(ids.rootRunId); }
			const formatted = formatResult(result); onUpdate?.(formatted); return formatted;
		} catch (error) {
			if (topology) try { await (deps.cleanupTopology ?? cleanupTopology)({ client: client!, capacity, result: topology }); } catch {}
			else for (const entry of prepared) if (entry.lease?.acquired) await capacity?.releaseWriteLease(entry.lease).catch(() => undefined);
			for (const entry of prepared) await entry.launch?.cleanupAfterFailure().catch(() => undefined);
			throw setupError(error);
		} finally { if (!deferClientDispose) client?.dispose(); }
	} };
}

function applyLife(leaf: HerdrLeafResult, life: LifecycleResult) {
	leaf.status = life.status; if (life.status === "blocked" && life.reason) leaf.blockedReason = life.reason;
	if (life.result && !life.result.pending && life.session) { leaf.piSession = { source: "herdr:pi", kind: "path", path: life.session.path, sessionId: life.result.sessionId, anchorEntryId: life.result.anchorEntryId, finalEntryId: life.result.finalEntryId }; if (life.result.output) leaf.finalOutput = life.result.output; leaf.stopReason = life.result.stopReason; leaf.usage = life.result.usage; if (life.result.error) leaf.error = life.result.error; }
	else if (life.session) leaf.piSession = { source: "herdr:pi", kind: "path", path: life.session.path, sessionId: life.session.sessionId };
	if (!leaf.error && life.status !== "succeeded" && life.status !== "blocked") leaf.error = makeError(lifecycleCode(life.status), life.reason ?? `Child ${life.status}.`);
}
export function formatSubagentPrompt(agents: readonly AgentProfile[]): string {
	const list = agents.length ? `\nAvailable user profiles:\n${agents.map(agent => `- ${agent.name} [${isDeclaredWriter(agent.tools) ? "declared writer: edit/write" : "no declared edit/write tools"}]: ${agent.description}`).join("\n")}` : "";
	return `## Subagents
Use \`subagent\` only inside managed Pi for interactive child panes.
Before parallel launch:
- Profiles declaring \`edit\` or \`write\` are writers. Parallel writers must use distinct existing canonical \`cwd\` values; omitted \`cwd\` values all resolve to caller cwd.
- A running or retained writer can hold its canonical cwd lease. Close it or choose another cwd before launching another writer there.
- For same-cwd parallel work, choose profiles without declared write tools. For same-cwd writer work, use \`chain\`.
- Set \`allowSharedWorkspaceWrites: true\` only when user explicitly accepts concurrent-write conflict risk.${list}`;
}

export default function (pi: ExtensionAPI) {
	const runtime = createHerdrSubagentRuntime();
	pi.on("before_agent_start", async (event, ctx) => { const agents = discoverAgentProfiles(ctx.cwd, "user").agents; return { systemPrompt: `${event.systemPrompt}\n\n${formatSubagentPrompt(agents)}` }; });
	pi.registerTool({ name: "subagent", label: "Subagent", description: "Spawn one visible Pi child tab with 1-4 panes. Before parallel launch, profiles declaring edit/write are writers: give every writer a distinct existing canonical cwd, use chain for same-cwd writers, or choose profiles without declared write tools. Same omitted cwd means same caller cwd. Set allowSharedWorkspaceWrites only when user explicitly accepts conflict risk.", parameters: HerdrSubagentParamsSchema, execute: async (_id, params, signal, onUpdate, ctx) => runtime.execute(params, ctx, signal, onUpdate), renderCall: renderSubagentCall, renderResult: renderSubagentResult });
	const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }) as Client, preflight: checkPreconditions, sessionRoot, runLifecycle: runLifecycleTurn, lifecyclePort: (client, paneId) => lifecyclePort(client as Client, paneId), sessionPort });
	pi.registerTool({ name: "subagent_control", label: "Subagent Control", description: "Control only locally owned subagent leaves.", parameters: HerdrSubagentControlParamsSchema, execute: async (_id, params) => control.execute(params) });
}
async function canonicalCwd(cwd: string) { const { realpath } = await import("node:fs/promises"); return realpath(cwd); }
function setupError(error: unknown): Error { if (error instanceof ContractValidationError || error instanceof PreconditionsError || error instanceof HerdrSetupError) return error; return new HerdrSetupError(errorCode(error), error instanceof Error ? error.message : "Herdr subagent setup failed."); }
function errorCode(error: unknown): ErrorCode { return error instanceof PreconditionsError ? error.code : typeof error === "object" && error && typeof (error as any).code === "string" ? (error as any).code : "agent_start_failed"; }
function lifecycleCode(status: string): ErrorCode { return status === "timed_out" ? "turn_timeout" : status === "lost" ? "pane_lost" : status === "aborted" ? "child_aborted" : "result_unavailable"; }
function object(value: any): any { return value && typeof value === "object" ? value : {}; }
function state(value: any): AgentSnapshot["state"] { const raw = object(value).agent_status ?? object(value).state ?? object(value).status; return raw === "idle" || raw === "working" || raw === "blocked" || raw === "done" ? raw : "unknown"; }
export function lifecyclePort(client: Client, paneId: string): HerdrLifecyclePort { return { getAgent: async (_id, signal) => { let raw: any; try { raw = await client.getAgent(paneId, { signal }); } catch (error) { if (error instanceof Error && /(?:pane|agent)_not_found/.test(error.message)) return undefined; throw error; } const agent = object(raw); const value = object(agent.agent ?? agent); return { paneId: String(value.pane_id ?? value.paneId ?? paneId), state: state(value), exists: value.exists !== false, agentInfo: value, blockedReason: typeof value.message === "string" ? value.message : undefined }; }, sendLiteral: async (_id, text, signal) => client.sendAgentInput(paneId, text, { signal }), sendEnter: async (_id, signal) => client.submitOwnedPane(paneId, { signal }), waitForEvent: async () => {}, interruptOwnedPane: async id => client.interruptOwnedPane(id), closeOwnedPane: async id => client.closePane(id), validateRetainedDone: async (_id, session, signal) => { const raw = object(await client.getAgent(paneId, { signal })); const agent = object(raw.agent ?? raw); if (!agent || agent.exists === false || String(agent.pane_id ?? agent.paneId ?? "") !== paneId || (state(agent) !== "idle" && state(agent) !== "done")) return false; try { const ref = await validatePiSessionRef(agent, session.root); if (ref.path !== session.path) return false; const trusted = await materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }); return !(trusted as any).pending && trusted.sessionId === session.sessionId; } catch { return false; } } }; }
export function sessionPort(root: string): SessionHarvestPort { const paths = new Map<SessionBaseline, any>(); return { prepare: async agent => { if (!("agent_session" in object(agent.agentInfo))) return { pending: true }; const ref = await validatePiSessionRef(agent.agentInfo, root); const baseline = await recordAbsentSessionBaseline(ref); paths.set(baseline, ref); return baseline; }, materialize: async baseline => materializeAndTrustSession(paths.get(baseline), baseline), findAnchor: async (session, marker) => findTurnAnchor(session, marker), harvest: async (session, marker, anchor, lifecycle) => harvestTurn(session, marker, anchor, lifecycle) }; }
