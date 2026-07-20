import type { CapacityReservation, WriteLease } from "./capacity.js";
import type { PiLaunchDescriptor } from "./pi-launch.js";

export type TopologyClient = {
	createTab(params: { workspaceId?: string; cwd?: string; label?: string }): Promise<unknown>;
	startAgent(params: { name: string; argv: string[]; cwd?: string; env?: Record<string, string>; tabId?: string; workspaceId?: string; split?: "right" | "down"; focus?: boolean }): Promise<unknown>;
	closePane(paneId: string): Promise<unknown>;
	closeTab?(tabId: string): Promise<unknown>;
	applyLayout?(params: { root: unknown; tabId?: string; tabLabel?: string; workspaceId?: string }): Promise<unknown>;
	snapshot?(): Promise<unknown>;
};
export type TopologyCapacity = {
	reserveGroup(input: { workspaceId: string; rootRunId: string; group: string; paneCount: number }): Promise<CapacityReservation>;
	bindGroup(reservation: CapacityReservation, tabId: string, paneIds: readonly string[]): Promise<CapacityReservation>;
	releaseGroup(reservation: Pick<CapacityReservation, "rootRunId" | "workspaceId">): Promise<void>;
	bindWriteLease(lease: WriteLease, paneId: string): Promise<WriteLease>;
	releaseWriteLease(lease: WriteLease): Promise<void>;
};
export type TopologyLeaf = { leafRunId: string; launch: PiLaunchDescriptor; lease?: WriteLease };
export type OwnedGroup = {
	rootRunId: string;
	workspaceId: string;
	tabId: string;
	tabLabel: string;
	bootstrapPaneId?: string;
	ownedPaneIds: Set<string>;
	acceptedLeafIds: Set<string>;
};
export type TopologyResult = { group: OwnedGroup; reservation: CapacityReservation; leases: Map<string, WriteLease>; warnings: string[] };
export class TopologyError extends Error { constructor(message: string) { super(message); this.name = "TopologyError"; } }
const closedTabs = new WeakSet<OwnedGroup>();
const groupLeafIds = new WeakMap<OwnedGroup, ReadonlySet<string>>();

/** Removes terminal controls and makes a short, stable display suffix. IDs remain protocol identities. */
export function topologyLabel(label: string, id: string, limit = 80): string {
	const clean = String(label).normalize("NFKC")
		.replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, "")
		.replace(/(?:\u001B\]|\u009D)[\s\S]*?(?:\u0007|\u001B\\|\u009C)/gu, "")
		.replace(/[\p{C}]/gu, "").replace(/\s+/gu, " ").trim();
	const short = String(id).replace(/[\p{C}]/gu, "").slice(0, 8) || "unknown";
	return `${clean || "Pi child"} · ${short}`.slice(0, limit);
}

/** Exact protocol-16 layout tree. Leaves are stable pane IDs, never screen positions. */
export function defaultLayout(paneIds: readonly string[]): unknown {
	if (paneIds.length < 1 || paneIds.length > 4 || paneIds.some(id => !id)) throw new RangeError("layout requires 1–4 pane IDs");
	const leaf = (paneId: string) => ({ type: "pane", pane_id: paneId });
	const split = (direction: "right" | "down", first: unknown, second: unknown) => ({ type: "split", direction, ratio: 0.5, first, second });
	if (paneIds.length === 1) return leaf(paneIds[0]!);
	if (paneIds.length === 2) return split("right", leaf(paneIds[0]!), leaf(paneIds[1]!));
	if (paneIds.length === 3) return split("right", leaf(paneIds[0]!), split("down", leaf(paneIds[1]!), leaf(paneIds[2]!)));
	return split("right", split("down", leaf(paneIds[0]!), leaf(paneIds[1]!)), split("down", leaf(paneIds[2]!), leaf(paneIds[3]!)));
}

export async function createTopology(input: { client: TopologyClient; capacity: TopologyCapacity; workspaceId: string; rootRunId: string; group: string; leaves: readonly TopologyLeaf[]; paneCount?: number }): Promise<TopologyResult> {
	const paneCount = input.paneCount ?? input.leaves.length;
	if (input.leaves.length < 1 || input.leaves.length > 4 || paneCount < input.leaves.length || paneCount > 4) throw new TopologyError("A managed group requires 1–4 leaves.");
	const leafIds = new Set(input.leaves.map(leaf => leaf.leafRunId));
	if (leafIds.size !== input.leaves.length || [...leafIds].some(id => !id)) throw new TopologyError("Leaf IDs must be unique and non-empty.");
	const reservation = await input.capacity.reserveGroup({ workspaceId: input.workspaceId, rootRunId: input.rootRunId, group: input.group, paneCount });
	const warnings: string[] = [];
	const leases = new Map<string, WriteLease>();
	let group: OwnedGroup | undefined;
	try {
		const tabResult = await input.client.createTab({ workspaceId: input.workspaceId, label: reservation.label });
		const tabId = resultId(tabResult, "tab"); const bootstrapPaneId = resultId(tabResult, "pane");
		group = { rootRunId: input.rootRunId, workspaceId: input.workspaceId, tabId, tabLabel: reservation.label, bootstrapPaneId, ownedPaneIds: new Set(), acceptedLeafIds: new Set() };
		groupLeafIds.set(group, leafIds);
		for (const [index, leaf] of input.leaves.entries()) {
			const started = await input.client.startAgent({ name: topologyLabel(leaf.launch.name, leaf.leafRunId), argv: [leaf.launch.executable, ...leaf.launch.argv], cwd: leaf.launch.cwd, env: leaf.launch.env, tabId, workspaceId: input.workspaceId, focus: false, ...(index ? { split: "right" } : {}) });
			const paneId = resultId(started, "pane"); group.ownedPaneIds.add(paneId);
			if (leaf.lease) {
				const boundLease = await input.capacity.bindWriteLease(leaf.lease, paneId);
				if (leaf.lease.acquired && !boundLease.acquired) { leases.set(leaf.leafRunId, leaf.lease); throw new TopologyError("Write lease binding failed."); }
				leases.set(leaf.leafRunId, boundLease);
			}
			// Bootstrap was never owned. Remove it only after first child has a stable pane ID.
			if (index === 0 && group.bootstrapPaneId) { await input.client.closePane(group.bootstrapPaneId); group.bootstrapPaneId = undefined; }
		}
		const bound = await input.capacity.bindGroup(reservation, group.tabId, [...group.ownedPaneIds]);
		if (!input.client.applyLayout) warnings.push("WARNING: Herdr layout capability unavailable; leaving default pane arrangement.");
		else try { await input.client.applyLayout({ root: defaultLayout([...group.ownedPaneIds]), tabId: group.tabId, tabLabel: group.tabLabel, workspaceId: group.workspaceId }); }
		catch { warnings.push("WARNING: Herdr layout apply failed; leaving default pane arrangement."); }
		return { group, reservation: bound, leases, warnings };
	} catch (error) {
		if (group && group.acceptedLeafIds.size === 0) await rollback(input.client, input.capacity, reservation, group, input.leaves, leases, warnings);
		throw error;
	}
}

/** Starts one later chain leaf in an existing owned tab. */
export async function addTopologyLeaf(input: { client: TopologyClient; capacity: TopologyCapacity; result: TopologyResult; leaf: TopologyLeaf }): Promise<string> {
	const { group } = input.result;
	if (!input.leaf.leafRunId || group.ownedPaneIds.size >= input.result.reservation.paneCount) throw new TopologyError("A managed group requires 1–4 leaves.");
	const started = await input.client.startAgent({ name: topologyLabel(input.leaf.launch.name, input.leaf.leafRunId), argv: [input.leaf.launch.executable, ...input.leaf.launch.argv], cwd: input.leaf.launch.cwd, env: input.leaf.launch.env, tabId: group.tabId, workspaceId: group.workspaceId, split: "right", focus: false });
	const paneId = resultId(started, "pane");
	try {
		if (input.leaf.lease) {
			const lease = await input.capacity.bindWriteLease(input.leaf.lease, paneId);
			if (input.leaf.lease.acquired && !lease.acquired) throw new TopologyError("Write lease binding failed.");
			input.result.leases.set(input.leaf.leafRunId, lease);
		}
		group.ownedPaneIds.add(paneId);
		const ids = new Set(groupLeafIds.get(group) ?? []); ids.add(input.leaf.leafRunId); groupLeafIds.set(group, ids);
		input.result.reservation = await input.capacity.bindGroup(input.result.reservation, group.tabId, [...group.ownedPaneIds]);
		return paneId;
	} catch (error) { await input.client.closePane(paneId).catch(() => undefined); throw error; }
}

/** Lifecycle calls this only after literal task delivery has been accepted. */
export function acceptLeaf(group: OwnedGroup, leafRunId: string) {
	if (!leafRunId || !groupLeafIds.get(group)?.has(leafRunId)) throw new TopologyError("leafRunId is not owned by this group.");
	group.acceptedLeafIds.add(leafRunId);
}

/** Idempotent ownership-safe cleanup. Foreign panes prevent tab closure. */
export async function cleanupTopology(input: { client: TopologyClient; capacity: TopologyCapacity; result: TopologyResult }): Promise<string[]> {
	const { client, capacity, result } = input; const { group } = result; const warnings: string[] = [];
	let foreign = true;
	if (client.snapshot) {
		try { foreign = snapshotPaneIds(await client.snapshot(), group.tabId).some(id => !group.ownedPaneIds.has(id)); }
		catch { warnings.push("WARNING: could not verify tab ownership; tab left open."); }
	}
	if (foreign) warnings.push("WARNING: foreign pane present; tab left open.");
	for (const paneId of [...group.ownedPaneIds]) {
		try { await client.closePane(paneId); group.ownedPaneIds.delete(paneId); }
		catch { warnings.push(`WARNING: failed to close owned pane ${paneId}.`); }
	}
	// Re-snapshot at close boundary: a foreign pane may arrive while owned panes close.
	if (!foreign && group.ownedPaneIds.size === 0 && client.closeTab && !closedTabs.has(group)) try {
		if (!client.snapshot) throw new Error("snapshot unavailable");
		const snapshot = await client.snapshot();
		if (snapshotPaneIds(snapshot, group.tabId).some(id => !group.ownedPaneIds.has(id))) warnings.push("WARNING: foreign pane present; tab left open.");
		else if (snapshotHasTab(snapshot, group.tabId) === false) closedTabs.add(group);
		else { await client.closeTab(group.tabId); closedTabs.add(group); }
	} catch { warnings.push("WARNING: failed to close owned tab."); }
	for (const lease of result.leases.values()) try { await capacity.releaseWriteLease(lease); } catch { warnings.push("WARNING: failed to release write lease."); }
	result.leases.clear();
	await capacity.releaseGroup(result.reservation).catch(() => warnings.push("WARNING: failed to release capacity reservation."));
	return warnings;
}

async function rollback(client: TopologyClient, capacity: TopologyCapacity, reservation: CapacityReservation, group: OwnedGroup, leaves: readonly TopologyLeaf[], leases: Map<string, WriteLease>, warnings: string[]) {
	for (const paneId of group.ownedPaneIds) try { await client.closePane(paneId); } catch { warnings.push(`WARNING: failed to roll back pane ${paneId}.`); }
	if (group.bootstrapPaneId) try { await client.closePane(group.bootstrapPaneId); } catch { warnings.push(`WARNING: failed to roll back bootstrap pane ${group.bootstrapPaneId}.`); }
	for (const lease of leases.values()) try { await capacity.releaseWriteLease(lease); } catch { /* original error wins */ }
	for (const leaf of leaves) try { await leaf.launch.cleanupAfterFailure(); } catch { /* original error wins */ }
	await capacity.releaseGroup(reservation).catch(() => undefined);
}
function resultId(value: unknown, kind: "tab" | "pane"): string {
	if (!value || typeof value !== "object") throw new TopologyError(`Herdr ${kind} result missing stable ID.`);
	const x = value as Record<string, unknown>; const keys = kind === "tab" ? ["tab_id", "tabId", "id"] : ["pane_id", "paneId"];
	for (const key of keys) if (typeof x[key] === "string" && x[key]) return x[key] as string;
	for (const key of [kind, "tab", "pane", "root_pane", "agent"]) { const nested = x[key]; if (nested && typeof nested === "object") try { return resultId(nested, kind); } catch { /* next shape */ } }
	throw new TopologyError(`Herdr ${kind} result missing stable ID.`);
}
function snapshotPaneIds(value: unknown, tabId: string): string[] {
	const snapshot = snapshotBody(value);
	if (!snapshot) return [];
	const panes = (snapshot as { panes?: unknown }).panes;
	if (!Array.isArray(panes)) return [];
	return panes.flatMap(pane => { if (!pane || typeof pane !== "object") return []; const x = pane as Record<string, unknown>; const id = x.pane_id ?? x.paneId ?? x.id; return (x.tab_id === tabId || x.tabId === tabId) && typeof id === "string" ? [id] : []; });
}
function snapshotHasTab(value: unknown, tabId: string): boolean | undefined {
	const tabs = snapshotBody(value)?.tabs;
	if (!Array.isArray(tabs)) return undefined;
	return tabs.some(tab => { if (!tab || typeof tab !== "object") return false; const x = tab as Record<string, unknown>; return (x.tab_id ?? x.tabId ?? x.id) === tabId; });
}
function snapshotBody(value: unknown): Record<string, unknown> | undefined {
	const snapshot = value && typeof value === "object" && "snapshot" in value ? (value as { snapshot: unknown }).snapshot : value;
	return snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : undefined;
}
