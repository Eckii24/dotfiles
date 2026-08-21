import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CapacityCoordinator, isDeclaredWriter, type WriteLease } from "./capacity.js";
import { discoverAgentProfiles, parseAllowedChildren, projectProfilesRequiringConfirmation, type AgentProfile } from "./agent-profiles.js";
import { HerdrSubagentParamsSchema, HerdrSubagentControlParamsSchema, ContractValidationError, createRunIds, makeError, normalizeSubagentParams, type ErrorCode, type HerdrLeafResult, type HerdrSubagentResult, type NormalizedItem } from "./contracts.js";
import { DEFAULT_MAX_PAYLOAD_BYTES, HerdrClient, paneSendTextRequestByteLength } from "./herdr-client.js";
import { runLifecycleTurn, type AgentSnapshot, type HerdrLifecyclePort, type LifecycleResult, type SessionHarvestPort } from "./lifecycle.js";
import { PI_HERDR_AGENT_PROFILE, PI_HERDR_ALLOWED_CHILDREN, createPiLaunchDescriptor, type PiLaunchDescriptor } from "./pi-launch.js";
import { findTurnAnchor, harvestTurn, materializeAndTrustSession, recordAbsentSessionBaseline, validatePiSessionRef, type SessionBaseline } from "./pi-session.js";
import { checkPreconditions, MAX_NESTING_DEPTH, PreconditionsError, type PreconditionsContext } from "./preconditions.js";
import { RunRegistry } from "./run-registry.js";
import { acceptLeaf, addTopologyLeaf, agentStartName, cleanupTopology, createTopology, startTopologyAgent, type TopologyResult } from "./topology.js";
import { formatResult } from "./result-format.js";
import { renderSubagentCall, renderSubagentResult } from "./subagent-render.js";
import { createHerdrSubagentControlRuntime } from "./control.js";
import { createTaskDelivery } from "./task-delivery.js";

const sessionRoot = join(homedir(), ".pi", "agent", "sessions");
type ToolUpdate = (value: any) => void;
type RuntimeContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui" | "model" | "thinkingLevel"> & { activeTools: string[] };
type Client = HerdrClient & Record<string, any>;
export type HerdrRuntimeDependencies = {
	preflight?: () => Promise<PreconditionsContext>; discover?: typeof discoverAgentProfiles; createClient?: (socketPath: string) => Client;
	createCapacity?: (client: Client) => any; createLaunch?: (input: any) => Promise<PiLaunchDescriptor>; createTopology?: typeof createTopology;
	addTopologyLeaf?: typeof addTopologyLeaf; cleanupTopology?: typeof cleanupTopology; acceptLeaf?: typeof acceptLeaf; restartAgent?: typeof startTopologyAgent;
	runLifecycle?: typeof runLifecycleTurn; ids?: () => { rootRunId: string; leafRunId: string; turnId: string }; now?: () => number;
	sessionRoot?: string; registry?: RunRegistry; env?: NodeJS.ProcessEnv;
};
export class HerdrSetupError extends Error { constructor(readonly code: ErrorCode, message: string) { super(message); this.name = "HerdrSetupError"; } }
type PreparedLeaf = { item: NormalizedItem; profile: any; cwd: string; ids: { leafRunId: string; turnId: string }; lease?: WriteLease; launch: PiLaunchDescriptor; leaf: HerdrLeafResult; life?: LifecycleResult };

/** Single, parallel, and chain share validation/preflight, but chain starts topology leaves only after success. */
export function createHerdrSubagentRuntime(deps: HerdrRuntimeDependencies = {}) {
	const registry = deps.registry ?? new RunRegistry(); const now = deps.now ?? Date.now; const env = deps.env ?? process.env;
	const discover = deps.discover ?? discoverAgentProfiles; const createClient = deps.createClient ?? (path => new HerdrClient({ socketPath: path }) as Client);
	return { registry, async shutdown() {
		const roots = registry.rootsSnapshot(); if (!roots.length) return;
		let client: Client | undefined;
		try {
			const preflight = await (deps.preflight ?? checkPreconditions)(); client = createClient(preflight.socketPath);
			for (const root of roots) {
				const launched = root.leaves.filter(leaf => leaf.paneId);
				const owned = new Set(launched.map(leaf => leaf.paneId));
				let tabSafe = false;
				try { tabSafe = !shutdownTabPanes(await client.snapshot(), root.tabId).some(id => !owned.has(id)); } catch { /* unknown ownership leaves tab open */ }
				let closed = true;
				for (const leaf of launched) try { await client.closePane(leaf.paneId); } catch { closed = false; }
				if (!closed) continue;
				try { await registry.release(root.rootRunId); registry.close(root.rootRunId); } catch { /* retain authority if release fails */ }
				if (!tabSafe) continue;
				try {
					if (shutdownTabPanes(await client.snapshot(), root.tabId).some(id => !owned.has(id))) continue;
					await client.closeTab(root.tabId);
				} catch { /* snapshot/close failure leaves tab open */ }
			}
		} catch { /* preflight/client failure retains leases and local authority */ } finally { client?.dispose(); }
	}, async execute(raw: unknown, ctx: RuntimeContext, signal?: AbortSignal, onUpdate?: ToolUpdate): Promise<any> {
		let topology: TopologyResult | undefined; let client: Client | undefined; let capacity: any; let prepared: PreparedLeaf[] = []; let deferClientDispose = false; let registeredRootRunId: string | undefined;
		try {
			const input = normalizeSubagentParams(raw);
			const preflight = await (deps.preflight ?? checkPreconditions)();
			if (preflight.nestingDepth >= MAX_NESTING_DEPTH) throw new PreconditionsError("nesting_depth_exceeded", `Pi child nesting may not exceed ${MAX_NESTING_DEPTH}.`);
			const items: NormalizedItem[] = input.mode === "single" ? [{ name: input.agent!, agent: input.agent!, task: input.task!, cwd: input.cwd, inputIndex: 0 }] : input.items!;
			const callerCwd = await canonicalCwd(ctx.cwd);
			const resolvedItems = await Promise.all(items.map(async item => ({ item, cwd: await canonicalCwd(item.cwd ?? callerCwd) })));
			if (env.PI_SANDBOX === "gondolin" && resolvedItems.some(({ cwd }) => cwd !== callerCwd)) throw new HerdrSetupError("invalid_execution_mode", "Gondolin subagents must use the caller cwd.");
			prepared = resolvedItems.map(({ item, cwd }, index) => {
				const profile = discover(cwd, input.agentScope).agents.find(agent => agent.name === item.agent);
				if (!profile) throw new HerdrSetupError("agent_profile_not_found", `Agent profile ${item.agent} was not found in ${input.agentScope} scope.`);
				const id = index === 0 ? (deps.ids ?? createRunIds)() : createRunIds();
				return { item, profile, cwd, ids: { leafRunId: id.leafRunId, turnId: id.turnId } } as Omit<PreparedLeaf, "lease" | "launch" | "leaf">;
			});
			enforceNestedDelegationPolicy(env, prepared);
			const requestedProject = projectProfilesRequiringConfirmation(prepared.map(x => x.profile));
			if (input.mode === "parallel") {
				const writerCwds = new Set<string>();
				for (const entry of prepared) if (isDeclaredWriter(entry.profile.tools)) {
					if (writerCwds.has(entry.cwd) && !input.allowSharedWorkspaceWrites) throw new HerdrSetupError("shared_workspace_write_conflict", "Parallel writers require distinct canonical cwd values.");
					writerCwds.add(entry.cwd);
				}
			}
			if (requestedProject.length && input.confirmProjectAgents) {
				if (!ctx.hasUI) throw new HerdrSetupError("project_agent_not_confirmed", "Project-local agent requires confirmation.");
				if (!(await ctx.ui.confirm("Run project-local Herdr agents?", `Agents: ${requestedProject.map(profile => profile.name).join(", ")}\nSources: ${requestedProject.map(profile => profile.filePath).join(", ")}`))) throw new HerdrSetupError("project_agent_not_confirmed", "Project-local agent was not approved.");
			}
			const ids = (deps.ids ?? createRunIds)();
			// Replace provisional first leaf IDs: root ID is deliberately common, leaf/turn remain per item.
			prepared[0]!.ids = { leafRunId: ids.leafRunId, turnId: ids.turnId };
			client = createClient(preflight.socketPath); capacity = deps.createCapacity?.(client) ?? new CapacityCoordinator({ snapshot: () => client!.snapshot() });
			for (const [index, entry] of prepared.entries()) {
				// Later chain leaves acquire only when their pane is about to exist.
				if (input.mode !== "chain" || index === 0) entry.lease = await capacity.acquireWriteLease({ cwd: entry.cwd, rootRunId: ids.rootRunId, tools: entry.profile.tools, allowSharedWorkspaceWrites: input.allowSharedWorkspaceWrites });
				entry.launch = await (deps.createLaunch ?? createPiLaunchDescriptor)({
					piExecutable: preflight.piExecutable,
					cwd: entry.cwd,
					profile: entry.profile,
					parentRuntime: {
						...(ctx.model ? { model: `${ctx.model.provider}/${ctx.model.id}` } : {}),
						...(ctx.thinkingLevel ? { thinking: ctx.thinkingLevel } : {}),
						tools: ctx.activeTools,
					},
					rootRunId: ids.rootRunId,
					leafRunId: entry.ids.leafRunId,
					parentRootRunId: preflight.parentRootRunId,
					nestingDepth: preflight.nestingDepth,
					group: input.group,
				});
				entry.leaf = { leafRunId: entry.ids.leafRunId, name: entry.item.name, agent: entry.profile.name, cwd: entry.cwd, paneId: "", paneLabel: "", status: "queued" };
			}
			const first = prepared[0]!;
			topology = await (deps.createTopology ?? createTopology)({ client, capacity, workspaceId: preflight.workspaceId, rootRunId: ids.rootRunId, group: input.group, paneCount: prepared.length, leaves: input.mode === "chain" ? [{ leafRunId: first.ids.leafRunId, launch: first.launch, lease: first.lease! }] : prepared.map(x => ({ leafRunId: x.ids.leafRunId, launch: x.launch, lease: x.lease! })) });
			const paneIds = [...topology.group.ownedPaneIds];
			for (const [index, entry] of prepared.entries()) if (input.mode !== "chain" || index === 0) { entry.leaf.paneId = paneIds.shift()!; entry.leaf.paneLabel = entry.launch.name; entry.leaf.status = "booting"; }
			registry.register({ rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, status: "working", keepOpen: input.keepOpen, leaves: prepared.map(x => ({ leafRunId: x.ids.leafRunId, paneId: x.leaf.paneId, status: x.leaf.status, activeTurnId: x.ids.turnId })) });
			registeredRootRunId = ids.rootRunId;
			for (const entry of prepared) registry.setFollowUpExpectations(ids.rootRunId, entry.ids.leafRunId, { agentName: agentStartName(entry.ids.leafRunId), sessionName: entry.launch.name });
			registry.setRelease(ids.rootRunId, async () => { for (const lease of topology!.leases.values()) await capacity.releaseWriteLease(lease); topology!.leases.clear(); await capacity.releaseGroup(topology!.reservation); });
			const startedAt = now();
			const run = async (entry: PreparedLeaf, task = entry.item.task): Promise<LifecycleResult> => {
				const delivery = createTaskDelivery(task, entry.ids.turnId);
				validatePaneTextPayload(entry.leaf.paneId, delivery.prompt);
				let life: LifecycleResult;
				for (let bootAttempt = 0; ; bootAttempt += 1) {
					try { life = await (deps.runLifecycle ?? runLifecycleTurn)(lifecyclePort(client!, entry.leaf.paneId), sessionPort(deps.sessionRoot ?? sessionRoot), { agentId: entry.leaf.paneId, task: delivery.prompt, marker: delivery.marker, turnId: entry.ids.turnId, timeoutMs: input.timeoutSeconds * 1000, clock: { now }, sleeper: { sleep: async ms => await new Promise(resolve => setTimeout(resolve, ms)) }, signal, onReady: async () => { await entry.launch.cleanupAfterReady(); entry.leaf.status = "working"; registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: "working" }); } }); }
					catch (error) { if (!(error instanceof Error) || !/(?:pane|agent)_not_found/.test(error.message)) throw error; life = { status: "lost", delivered: true, enterSent: true, state: "unknown", reason: "Owned pane disappeared during delivery." }; }
					// Safe retry boundary: no task literal or Enter reached the child.
					if (life.status !== "lost" || life.delivered || bootAttempt > 0) break;
					entry.leaf.status = "booting";
					registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: "booting" });
					try { await (deps.restartAgent ?? startTopologyAgent)(client!, entry.leaf.paneId, { leafRunId: entry.ids.leafRunId, launch: entry.launch, ...(entry.lease ? { lease: entry.lease } : {}) }); }
					catch { life = { status: "lost", delivered: false, enterSent: false, state: "unknown", reason: "Child exited during boot; one restart failed." }; break; }
				}
				entry.life = life; applyLife(entry.leaf, life); if (life.delivered) (deps.acceptLeaf ?? acceptLeaf)(topology!.group, entry.ids.leafRunId);
				// Defensive compatibility for injected/legacy blocked lifecycle results. Native
				// blocks stay inside runLifecycleTurn until visibly resolved or timed out.
				const active = life.delivered && (life.status === "blocked" || life.status === "timed_out");
				registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: entry.leaf.status, activeTurnId: active ? entry.ids.turnId : undefined, activeMarker: active ? delivery.marker : undefined, ...(entry.leaf.piSession ? { session: { source: "herdr:pi", path: entry.leaf.piSession.path, sessionId: entry.leaf.piSession.sessionId, anchorEntryId: entry.leaf.piSession.anchorEntryId, finalEntryId: entry.leaf.piSession.finalEntryId } } : {}), ...terminalPatch(life) });
				registry.recomputeRoot(ids.rootRunId);
				return life;
			};
			if (input.mode === "parallel") {
				const safeRun = async (entry: PreparedLeaf): Promise<LifecycleResult> => {
					try { return await run(entry); }
					catch (error) {
						const life: LifecycleResult = { status: "failed", delivered: false, enterSent: false, state: "unknown", reason: error instanceof Error ? error.message : "Child lifecycle failed." };
						entry.life = life; applyLife(entry.leaf, life);
						registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { status: entry.leaf.status, activeTurnId: undefined, activeMarker: undefined });
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
					const result: HerdrSubagentResult = { protocolVersion: 1, rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), nestingDepth: preflight.nestingDepth + 1, group: input.group, mode: input.mode, status: "blocked", workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, keepOpen: input.keepOpen, startedAt, finishedAt: now(), children: prepared.map(x => x.leaf), warnings: [...topology.warnings, ...prepared.flatMap(x => x.lease?.warning ? [x.lease.warning] : [])] };
					const backgroundClient = client; deferClientDispose = true;
					void Promise.all(runs).then(async () => {
						for (const entry of prepared) if (!entry.life?.delivered) await entry.launch.cleanupAfterFailure().catch(() => undefined);
						registry.recomputeRoot(ids.rootRunId);
						// Do not release bound leases: blocked/retained panes remain write-capable.
					}).catch(() => undefined).finally(() => { try { backgroundClient?.dispose(); } catch {} });
					const formatted = formatResult(result, retainedControls(registry, result)); onUpdate?.(formatted); return formatted;
				}
				await Promise.all(runs);
			}
			else {
				let previous = "";
				for (const [index, entry] of prepared.entries()) {
					const task = expandChainTask(entry.item.task, previous);
					if (index) {
						entry.lease = await capacity.acquireWriteLease({ cwd: entry.cwd, rootRunId: ids.rootRunId, tools: entry.profile.tools, allowSharedWorkspaceWrites: input.allowSharedWorkspaceWrites });
						try {
							const paneId = await (deps.addTopologyLeaf ?? addTopologyLeaf)({ client, capacity, result: topology, leaf: { leafRunId: entry.ids.leafRunId, launch: entry.launch, lease: entry.lease! } });
							entry.leaf.paneId = paneId; entry.leaf.paneLabel = entry.launch.name; entry.leaf.status = "booting"; registry.updateLeaf(ids.rootRunId, entry.ids.leafRunId, { paneId, status: "booting" });
						} catch (error) {
							// addTopologyLeaf transfers ownership only after recording its bound lease.
							if (entry.lease?.acquired && !topology.leases.has(entry.ids.leafRunId)) await capacity.releaseWriteLease(entry.lease).catch(() => undefined);
							throw error;
						}
					}
					const life = await run(entry, task); if (life.status !== "succeeded") break;
					previous = entry.leaf.finalOutput ?? "";
				}
			}
			// Chain entries after the first non-success never get panes. Keep them in the
			// public result as queued, but remove them from local control authority so
			// root-wide close can release the launched topology and its leases.
			if (input.mode === "chain") for (const entry of prepared) if (!entry.leaf.paneId && entry.leaf.status === "queued") registry.close(ids.rootRunId, entry.ids.leafRunId);
			for (const entry of prepared) if (!entry.life || !entry.life.delivered) await entry.launch.cleanupAfterFailure().catch(() => undefined);
			// Discard any provisional lease not transferred to topology ownership.
			if (input.mode === "chain") for (const entry of prepared) if (entry.lease?.acquired && !topology.leases.has(entry.ids.leafRunId)) await capacity.releaseWriteLease(entry.lease).catch(() => undefined);
			const completed = prepared.filter(x => x.life).map(x => x.life!);
			const status = completed.some(x => x.status === "blocked") ? "blocked" : completed.some(x => x.status === "timed_out") ? "timed_out" : completed.some(x => x.status === "aborted") ? "aborted" : completed.some(x => x.status !== "succeeded") ? "failed" : "succeeded";
			registry.updateRoot(ids.rootRunId, { status });
			const result: HerdrSubagentResult = { protocolVersion: 1, rootRunId: ids.rootRunId, ...(preflight.parentRootRunId ? { parentRootRunId: preflight.parentRootRunId } : {}), nestingDepth: preflight.nestingDepth + 1, group: input.group, mode: input.mode, status, workspaceId: preflight.workspaceId, tabId: topology.group.tabId, tabLabel: topology.group.tabLabel, keepOpen: input.keepOpen, startedAt, finishedAt: now(), children: prepared.map(x => x.leaf), warnings: [...topology.warnings, ...(input.mode === "parallel" && input.allowSharedWorkspaceWrites && prepared.filter(x => isDeclaredWriter(x.profile.tools)).length > new Set(prepared.filter(x => isDeclaredWriter(x.profile.tools)).map(x => x.cwd)).size ? ["WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict."] : []), ...prepared.flatMap(x => x.lease?.warning ? [x.lease.warning] : [])] };
			if (!input.keepOpen && status !== "blocked" && status !== "timed_out") {
				result.warnings.push(...await (deps.cleanupTopology ?? cleanupTopology)({ client, capacity, result: topology }));
				if (topology.group.ownedPaneIds.size === 0) registry.close(ids.rootRunId);
			} else if (input.keepOpen && status !== "blocked") {
				// All panes stay open for inspection; only non-succeeded leaves give up their write lease.
				for (const entry of prepared) if (entry.leaf.status !== "succeeded" && entry.leaf.status !== "timed_out") {
					const lease = topology.leases.get(entry.ids.leafRunId);
					if (!lease) continue;
					try { await capacity.releaseWriteLease(lease); topology.leases.delete(entry.ids.leafRunId); }
					catch { result.warnings.push(`WARNING: failed to release write lease for leaf ${entry.ids.leafRunId}.`); }
				}
			}
			const formatted = formatResult(result, retainedControls(registry, result)); onUpdate?.(formatted); return formatted;
		} catch (error) {
			if (topology) try {
				await (deps.cleanupTopology ?? cleanupTopology)({ client: client!, capacity, result: topology });
				if (registeredRootRunId && topology.group.ownedPaneIds.size === 0) registry.close(registeredRootRunId);
			} catch {}
			else for (const entry of prepared) if (entry.lease?.acquired) await capacity?.releaseWriteLease(entry.lease).catch(() => undefined);
			for (const entry of prepared) await entry.launch?.cleanupAfterFailure().catch(() => undefined);
			throw setupError(error);
		} finally { if (!deferClientDispose) client?.dispose(); }
	} };
}

/** A Herdr child has no nested authority unless its launcher propagated a strict allowlist. */
function enforceNestedDelegationPolicy(env: NodeJS.ProcessEnv, prepared: Array<{ item: NormalizedItem; profile: AgentProfile }>) {
	if (typeof env[PI_HERDR_AGENT_PROFILE] !== "string" || !env[PI_HERDR_AGENT_PROFILE]!.trim()) return;
	let raw: unknown;
	try { raw = JSON.parse(env[PI_HERDR_ALLOWED_CHILDREN] ?? ""); } catch { raw = undefined; }
	const allowedChildren = parseAllowedChildren(raw);
	if (!allowedChildren) throw new HerdrSetupError("nested_delegation_forbidden", "Nested delegation is not authorized for this Herdr child profile.");
	if (prepared.length > 2) throw new HerdrSetupError("nested_delegation_forbidden", "Nested delegation may launch at most two read-only children.");
	for (const entry of prepared) {
		if (!allowedChildren.includes(entry.item.agent)) throw new HerdrSetupError("nested_delegation_forbidden", `Nested child profile ${entry.item.agent} is not authorized by this Herdr child profile.`);
		if (isDeclaredWriter(entry.profile.tools)) throw new HerdrSetupError("nested_delegation_forbidden", `Nested child profile ${entry.profile.name} must declare explicit read-only tools.`);
	}
}

/** {previous} becomes a one-line JSON string literal; consumers can recover prior output with JSON.parse. */
export function expandChainTask(template: string, previous: string): string {
	return template.replaceAll("{previous}", JSON.stringify(previous));
}

/** Validate actual pane.send_text bytes, not an expanded-task approximation. */
export function validatePaneTextPayload(paneId: string, text: string) {
	const bytes = paneSendTextRequestByteLength(paneId, text);
	if (bytes > DEFAULT_MAX_PAYLOAD_BYTES) throw new HerdrSetupError("task_delivery_failed", `Task delivery request exceeds ${DEFAULT_MAX_PAYLOAD_BYTES} UTF-8 bytes.`);
}

function retainedControls(registry: RunRegistry, result: HerdrSubagentResult) {
	const root = registry.get(result.rootRunId); if (!root) return undefined;
	const names = new Map(result.children.map(child => [child.leafRunId, child.name]));
	const retained = root.leaves.filter(leaf => leaf.paneId && (leaf.status === "blocked" || leaf.status === "timed_out" || (root.keepOpen && leaf.status === "succeeded")));
	const leaves = retained.map(leaf => ({ leafRunId: leaf.leafRunId, name: names.get(leaf.leafRunId), status: leaf.status }));
	return leaves.length ? { rootRunId: root.rootRunId, status: root.status, leaves } : undefined;
}
function terminalPatch(life: LifecycleResult) {
	const result = life.result;
	return result && !result.pending && life.session ? { terminal: { status: result.status, ...(result.output ? { output: result.output } : {}), ...(result.stopReason ? { stopReason: result.stopReason } : {}), sessionId: result.sessionId, anchorEntryId: result.anchorEntryId, finalEntryId: result.finalEntryId } } : {};
}
function applyLife(leaf: HerdrLeafResult, life: LifecycleResult) {
	leaf.status = life.status; if (life.status === "blocked" && life.reason) leaf.blockedReason = life.reason;
	if (life.result && !life.result.pending && life.session) { leaf.piSession = { source: "herdr:pi", kind: "path", path: life.session.path, sessionId: life.result.sessionId, anchorEntryId: life.result.anchorEntryId, finalEntryId: life.result.finalEntryId }; if (life.result.output) leaf.finalOutput = life.result.output; leaf.stopReason = life.result.stopReason; leaf.usage = life.result.usage; if (life.result.error) leaf.error = life.result.error; }
	else if (life.session) leaf.piSession = { source: "herdr:pi", kind: "path", path: life.session.path, sessionId: life.session.sessionId };
	if (!leaf.error && life.status !== "succeeded" && life.status !== "blocked") leaf.error = makeError(lifecycleCode(life.status), life.reason ?? `Child ${life.status}.`);
}
export function formatSubagentPrompt(agents: readonly AgentProfile[]): string {
	const list = agents.length ? `\nAvailable user profiles:\n${agents.map(agent => `- ${agent.name} [${isDeclaredWriter(agent.tools) ? agent.tools === undefined ? "writer: inherited caller tools (conservative)" : "writer: edit/write/bash" : "no writer tools"}; model: ${agent.model ?? "inherit"}; thinking: ${agent.thinking ?? "inherit"}]: ${agent.description}`).join("\n")}` : "";
	return `## Subagents
Use \`subagent\` only inside managed Pi for interactive child panes.
Before parallel launch:
- Profiles omitting \`model\`, \`thinking\`, or \`tools\` inherit the caller's effective value for that field. Profiles omitting \`tools\` are conservatively classified as writers. Profiles declaring \`edit\`, \`write\`, or \`bash\` are also writers. Parallel writers must use distinct existing canonical \`cwd\` values. Omit \`cwd\` unless an exact existing path is known; omitted values resolve to caller cwd.
- A running, blocked, or retained writer holds its canonical cwd lease until its pane closes. Close it or choose another cwd before launching another writer there.
- For same-cwd parallel work, choose profiles with explicit read-only tool lists. For same-cwd writer work, use \`chain\`.
- Set \`allowSharedWorkspaceWrites: true\` only when user explicitly accepts concurrent-write conflict risk.
Chain \`{previous}\`: prior final is inserted as one-line JSON string content (reversible with \`JSON.parse\`); final \`pane.send_text\` request, including sentinel and JSON encoding, must fit 65536 UTF-8 bytes.
Task and steer/follow-up CR/LF input is normalized to spaces before literal delivery.
Retained follow-up: \`follow_up\` only works for a locally owned \`keepOpen: true\` root with a succeeded trusted idle/done leaf. Pass rootRunId, leafRunId, non-empty message, and optional timeoutSeconds; select leaf whenever a handle is shown (required if multiple eligible). After its native final, same leaf may receive another follow_up; concurrent turns fail closed. When a child is blocked, resolve it visibly in its pane; parent lifecycle remains waiting for its native final. A timed_out child may still be live; use one bounded \`collect\` to reconcile its pane and native final. Never auto-approve child prompts or follow_up a blocked child. Do not use questionnaires, repeated status, or Bash sleep polling. Status is a local snapshot, not live proof. Use \`close\` to release retained panes.${list}`;
}

export default function (pi: ExtensionAPI) {
	const runtime = createHerdrSubagentRuntime();
	pi.on("before_agent_start", async (event, ctx) => { const agents = discoverAgentProfiles(ctx.cwd, "user").agents; return { systemPrompt: `${event.systemPrompt}\n\n${formatSubagentPrompt(agents)}` }; });
	pi.on("session_shutdown", async () => { await runtime.shutdown(); });
	pi.registerTool({ name: "subagent", label: "Subagent", description: "Spawn one visible Pi child tab with 1-4 panes. Before parallel launch, profiles omitting tools inherit the caller's active tools and are conservatively classified as writers; profiles declaring edit/write/bash are also writers. Give every writer a distinct existing canonical cwd, use chain for same-cwd writers, or choose profiles with an explicit read-only tool list. Omit cwd unless an exact existing path is known; omitted cwd uses caller cwd. CR/LF task input is normalized to spaces. Set allowSharedWorkspaceWrites only when user explicitly accepts conflict risk.", parameters: HerdrSubagentParamsSchema, execute: async (_id, params, signal, onUpdate, ctx) => runtime.execute(params, { ...ctx, activeTools: pi.getActiveTools() }, signal, onUpdate), renderCall: renderSubagentCall, renderResult: renderSubagentResult });
	const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }) as Client, preflight: checkPreconditions, sessionRoot, runLifecycle: runLifecycleTurn, lifecyclePort: (client, paneId) => lifecyclePort(client as Client, paneId), sessionPort });
	pi.registerTool({ name: "subagent_control", label: "Subagent Control", description: "Control only locally owned subagent leaves. follow_up requires a locally owned keepOpen root and succeeded trusted idle/done leaf; it accepts optional timeoutSeconds. Select a leaf when multiple eligible handles exist; native final remains follow_up eligible. Resolve a blocked child visibly in its pane; parent lifecycle remains waiting for its native final. A timed_out child may still be live; collect reconciles its pane and native final. Never auto-approve child prompts or follow_up a blocked child. Do not use questionnaires, repeated status, or Bash sleep polling. Status is local snapshot only. Use close to release retained panes when done.", parameters: HerdrSubagentControlParamsSchema, execute: async (_id, params, signal, onUpdate) => control.execute(params, signal, onUpdate) });
}
async function canonicalCwd(cwd: string) { const { realpath } = await import("node:fs/promises"); return realpath(cwd); }
function setupError(error: unknown): Error { if (error instanceof ContractValidationError || error instanceof PreconditionsError || error instanceof HerdrSetupError) return error; return new HerdrSetupError(errorCode(error), error instanceof Error ? error.message : "Herdr subagent setup failed."); }
function errorCode(error: unknown): ErrorCode { return error instanceof PreconditionsError ? error.code : typeof error === "object" && error && typeof (error as any).code === "string" ? (error as any).code : "agent_start_failed"; }
function lifecycleCode(status: string): ErrorCode { return status === "timed_out" ? "turn_timeout" : status === "lost" ? "pane_lost" : status === "aborted" ? "child_aborted" : "result_unavailable"; }
function object(value: any): any { return value && typeof value === "object" ? value : {}; }
function shutdownTabPanes(raw: any, tabId: string): string[] { const body = raw?.snapshot ?? raw?.result?.snapshot ?? raw; if (!Array.isArray(body?.panes)) throw new Error("snapshot panes unavailable"); return body.panes.flatMap((pane: any) => (pane?.tab_id === tabId || pane?.tabId === tabId) && typeof (pane.pane_id ?? pane.paneId) === "string" ? [pane.pane_id ?? pane.paneId] : []); }
function state(value: any): AgentSnapshot["state"] { const raw = object(value).agent_status ?? object(value).state ?? object(value).status; return raw === "idle" || raw === "working" || raw === "blocked" || raw === "done" ? raw : "unknown"; }
export function lifecyclePort(client: Client, paneId: string): HerdrLifecyclePort { return { getAgent: async (_id, signal) => { let raw: any; try { raw = await client.getAgent(paneId, { signal }); } catch (error) { if (error instanceof Error && /(?:pane|agent)_not_found/.test(error.message)) return undefined; throw error; } const agent = object(raw); const value = object(agent.agent ?? agent); return { paneId: String(value.pane_id ?? value.paneId ?? paneId), state: state(value), exists: value.exists !== false, agentInfo: value, blockedReason: typeof value.message === "string" ? value.message : undefined }; }, sendLiteral: async (_id, text, signal) => client.sendAgentInput(paneId, text, { signal }), sendEnter: async (_id, signal) => client.submitOwnedPane(paneId, { signal }), waitForEvent: async () => {}, interruptOwnedPane: async id => client.interruptOwnedPane(id), closeOwnedPane: async id => client.closePane(id), validateRetainedDone: async (_id, session, signal) => { const raw = object(await client.getAgent(paneId, { signal })); const agent = object(raw.agent ?? raw); if (!agent || agent.exists === false || String(agent.pane_id ?? agent.paneId ?? "") !== paneId || (state(agent) !== "idle" && state(agent) !== "done")) return false; try { const ref = await validatePiSessionRef(agent, session.root); if (ref.path !== session.path) return false; const trusted = await materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }); return !(trusted as any).pending && trusted.sessionId === session.sessionId; } catch { return false; } } }; }
export function sessionPort(root: string): SessionHarvestPort { const paths = new Map<SessionBaseline, any>(); return { prepare: async agent => { if (!("agent_session" in object(agent.agentInfo))) return { pending: true }; const ref = await validatePiSessionRef(agent.agentInfo, root); const baseline = await recordAbsentSessionBaseline(ref); paths.set(baseline, ref); return baseline; }, materialize: async baseline => materializeAndTrustSession(paths.get(baseline), baseline), findAnchor: async (session, marker) => findTurnAnchor(session, marker), harvest: async (session, marker, anchor, lifecycle) => harvestTurn(session, marker, anchor, lifecycle) }; }
