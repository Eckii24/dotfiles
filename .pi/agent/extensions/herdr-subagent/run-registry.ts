import { managedTabSuffix } from "./capacity.js";
import type { HerdrError } from "./contracts.js";

export type RegistryRootStatus = "working" | "succeeded" | "blocked" | "failed" | "aborted" | "timed_out" | "lost";
export type RegistryLeafStatus = "queued" | "booting" | "working" | "blocked" | "succeeded" | "failed" | "aborted" | "timed_out" | "lost";
export type RunSessionIdentity = { source: "herdr:pi"; path: string; sessionId?: string; anchorEntryId?: string; finalEntryId?: string };
/** Active turn marker is process-local control state, never a public pane target. */
export type RunLeafHandle = { leafRunId: string; paneId: string; status: RegistryLeafStatus; session?: RunSessionIdentity; activeTurnId?: string; activeMarker?: string };
export type RunRootHandle = {
	rootRunId: string;
	parentRootRunId?: string;
	workspaceId: string;
	tabId: string;
	tabLabel: string;
	status: RegistryRootStatus;
	keepOpen: boolean;
	leaves: RunLeafHandle[];
};
export type RegisterRun = Omit<RunRootHandle, "leaves"> & { leaves: readonly RunLeafHandle[] };
export type ControlResolution = { ok: true; root: RunRootHandle; leaf?: RunLeafHandle } | { ok: false; error: HerdrError };
/** Private launch names used only for authoritative follow-up validation. */
export type FollowUpExpectations = { agentName: string; sessionName: string };
export type RecoveryResult = { status: "recovered"; root: RunRootHandle } | { status: "lost"; root: RunRootHandle } | { status: "unowned"; error: HerdrError };

const ROOT_ENV = "PI_HERDR_ROOT_RUN_ID";
const LEAF_ENV = "PI_HERDR_LEAF_RUN_ID";
const PARENT_ENV = "PI_HERDR_PARENT_ROOT_RUN_ID";

/** Process-local handles only. Snapshot recovery deliberately has no filesystem or durable-record input. */
export class RunRegistry {
	private readonly roots = new Map<string, RunRootHandle>();
	private readonly releases = new Map<string, () => Promise<void>>();
	private readonly followUpExpectations = new Map<string, Map<string, FollowUpExpectations>>();

	register(input: RegisterRun): RunRootHandle {
		const root = copyRoot(input);
		if (this.roots.has(root.rootRunId)) throw new RunRegistryError("duplicate rootRunId");
		this.roots.set(root.rootRunId, root);
		return copyRoot(root);
	}

	get(rootRunId: string): RunRootHandle | undefined { return copyMaybe(this.roots.get(rootRunId)); }
	/** Process-local release hook; never persisted or exposed through result handles. */
	setRelease(rootRunId: string, release: () => Promise<void>) { if (this.roots.has(rootRunId)) this.releases.set(rootRunId, release); }
	/** Private launch expectations; public root/leaf copies never include these values. */
	setFollowUpExpectations(rootRunId: string, leafRunId: string, values: FollowUpExpectations) {
		if (!this.roots.get(rootRunId)?.leaves.some(leaf => leaf.leafRunId === leafRunId)) return;
		this.followUpExpectations.get(rootRunId)?.set(leafRunId, { ...values }) ?? this.followUpExpectations.set(rootRunId, new Map([[leafRunId, { ...values }]]));
	}
	getFollowUpExpectations(rootRunId: string, leafRunId: string): FollowUpExpectations | undefined {
		const values = this.followUpExpectations.get(rootRunId)?.get(leafRunId); return values && { ...values };
	}
	async release(rootRunId: string) { const release = this.releases.get(rootRunId); this.releases.delete(rootRunId); await release?.(); }
	getLeaf(rootRunId: string, leafRunId: string): RunLeafHandle | undefined {
		return copyLeaf(this.roots.get(rootRunId)?.leaves.find(leaf => leaf.leafRunId === leafRunId));
	}

	updateRoot(rootRunId: string, patch: Pick<Partial<RunRootHandle>, "status" | "keepOpen" | "tabId" | "tabLabel">): RunRootHandle | undefined {
		const root = this.roots.get(rootRunId); if (!root) return undefined;
		Object.assign(root, patch); return copyRoot(root);
	}
	updateLeaf(rootRunId: string, leafRunId: string, patch: Pick<Partial<RunLeafHandle>, "status" | "paneId" | "session" | "activeTurnId" | "activeMarker">): RunLeafHandle | undefined {
		const leaf = this.roots.get(rootRunId)?.leaves.find(value => value.leafRunId === leafRunId);
		if (!leaf) return undefined;
		Object.assign(leaf, patch); return copyLeaf(leaf);
	}
	/** Atomic process-local transition. Exactly one concurrent follow-up may claim a completed leaf. */
	claimFollowUp(rootRunId: string, leafRunId: string, turnId: string, marker: string): RunLeafHandle | undefined {
		const leaf = this.roots.get(rootRunId)?.leaves.find(value => value.leafRunId === leafRunId);
		if (!leaf || leaf.status !== "succeeded" || leaf.activeTurnId || !turnId || !marker) return undefined;
		Object.assign(leaf, { status: "working", activeTurnId: turnId, activeMarker: marker, session: leaf.session && { ...leaf.session, anchorEntryId: undefined, finalEntryId: undefined } });
		return copyLeaf(leaf);
	}

	/** A root controls itself and registered descendants; descendants never control ancestors or siblings. */
	resolveControl(controllerRootRunId: string, targetRootRunId: string, leafRunId?: string): ControlResolution {
		const root = this.roots.get(targetRootRunId);
		if (!this.roots.has(controllerRootRunId) || !root || !this.owns(controllerRootRunId, targetRootRunId)) return foreign();
		const leaf = leafRunId === undefined ? undefined : root.leaves.find(value => value.leafRunId === leafRunId);
		if (leafRunId !== undefined && !leaf) return foreign();
		return { ok: true, root: copyRoot(root), ...(leaf ? { leaf: copyLeaf(leaf)! } : {}) };
	}

	/** Removes only local authority after successful close; no durable tombstone is retained. */
	close(rootRunId: string, leafRunId?: string): boolean {
		const root = this.roots.get(rootRunId); if (!root) return false;
		if (leafRunId === undefined) { this.releases.delete(rootRunId); this.followUpExpectations.delete(rootRunId); return this.roots.delete(rootRunId); }
		const index = root.leaves.findIndex(leaf => leaf.leafRunId === leafRunId);
		if (index < 0) return false;
		root.leaves.splice(index, 1); this.followUpExpectations.get(rootRunId)?.delete(leafRunId); return true;
	}

	/**
	 * Rebuilds a handle only from an injected current Herdr snapshot. A matching label narrows
	 * candidates; full PI_HERDR root/leaf metadata proves each pane. Any collision fails closed.
	 */
	recover(rootRunId: string, snapshot: unknown): RecoveryResult {
		const current = this.roots.get(rootRunId);
		const candidate = discovery(rootRunId, snapshot);
		if (!candidate) {
			if (!current) return { status: "unowned", error: ownershipError("Run is not locally known and snapshot ownership proof is absent.") };
			current.status = "lost";
			for (const leaf of current.leaves) leaf.status = "lost";
			return { status: "lost", root: copyRoot(current) };
		}
		const recovered: RunRootHandle = {
			rootRunId, parentRootRunId: candidate.parentRootRunId ?? current?.parentRootRunId, workspaceId: candidate.workspaceId ?? current?.workspaceId ?? "",
			tabId: candidate.tabId, tabLabel: candidate.tabLabel, status: current?.status === "lost" ? "working" : (current?.status ?? "working"),
			keepOpen: current?.keepOpen ?? true, leaves: candidate.leaves.map(found => {
				const old = current?.leaves.find(leaf => leaf.leafRunId === found.leafRunId);
				return { leafRunId: found.leafRunId, paneId: found.paneId, status: old?.status === "lost" ? "working" : (old?.status ?? found.status), ...(found.session ? { session: found.session } : old?.session ? { session: old.session } : {}) };
			}),
		};
		this.roots.set(rootRunId, recovered);
		return { status: "recovered", root: copyRoot(recovered) };
	}

	private owns(controllerRootRunId: string, targetRootRunId: string): boolean {
		const seen = new Set<string>(); let cursor: string | undefined = targetRootRunId;
		while (cursor && !seen.has(cursor)) {
			if (cursor === controllerRootRunId) return true;
			seen.add(cursor); cursor = this.roots.get(cursor)?.parentRootRunId;
		}
		return false;
	}
}

export class RunRegistryError extends Error { constructor(message: string) { super(message); this.name = "RunRegistryError"; } }
/** Reserved display suffix. It is never, by itself, an ownership proof. */
export const runTabSuffix = managedTabSuffix;
export function hasRunTabSuffix(label: string, rootRunId: string): boolean { return typeof label === "string" && label.endsWith(managedTabSuffix(rootRunId)); }

function discovery(rootRunId: string, snapshot: unknown): { tabId: string; tabLabel: string; workspaceId?: string; parentRootRunId?: string; leaves: Array<RunLeafHandle> } | undefined {
	const records = walk(unwrap(snapshot));
	const tabs = unique(records.flatMap(record => {
		const tabId = id(record, ["tab_id", "tabId"]); const label = text(record, ["label", "tab_label", "tabLabel"]);
		return tabId && label && hasRunTabSuffix(label, rootRunId) ? [{ tabId, tabLabel: label, workspaceId: text(record, ["workspace_id", "workspaceId"]) }] : [];
	}), tab => `${tab.tabId}\u0000${tab.tabLabel}`);
	// A short suffix collision, duplicate snapshot record, or duplicate matching tab is unsafe.
	if (tabs.length !== 1) return undefined;
	const tab = tabs[0]!;
	const leaves = unique(records.flatMap(record => {
		if (id(record, ["tab_id", "tabId"]) !== tab.tabId) return [];
		const paneId = id(record, ["pane_id", "paneId"]); const metadata = env(record);
		if (!paneId || metadata[ROOT_ENV] !== rootRunId || !validId(metadata[LEAF_ENV])) return [];
		const state = leafStatus(text(record, ["state", "status"])); const session = sessionIdentity(record);
		return [{ leafRunId: metadata[LEAF_ENV]!, paneId, status: state, ...(validId(metadata[PARENT_ENV]) ? { parentRootRunId: metadata[PARENT_ENV] } : {}), ...(session ? { session } : {}) }];
	}), leaf => leaf.leafRunId);
	// A label without metadata, or same leaf claimed by multiple panes, is not recoverable.
	if (leaves.length === 0 || leaves.some(leaf => records.filter(record => id(record, ["tab_id", "tabId"]) === tab.tabId && id(record, ["pane_id", "paneId"]) && env(record)[ROOT_ENV] === rootRunId && env(record)[LEAF_ENV] === leaf.leafRunId).length !== 1)) return undefined;
	const parents = [...new Set(leaves.map(leaf => leaf.parentRootRunId).filter(validId))];
	if (parents.length > 1) return undefined;
	return { ...tab, ...(parents[0] ? { parentRootRunId: parents[0] } : {}), leaves: leaves.map(({ parentRootRunId: _, ...leaf }) => leaf) }; 
}

function copyRoot(root: RegisterRun | RunRootHandle): RunRootHandle {
	if (!validId(root.rootRunId) || !validId(root.tabId) || typeof root.tabLabel !== "string") throw new RunRegistryError("root requires stable IDs and label");
	const leaves = root.leaves.map(copyLeaf); if (new Set(leaves.map(leaf => leaf!.leafRunId)).size !== leaves.length || leaves.some(leaf => !leaf)) throw new RunRegistryError("leafRunId must be unique and non-empty");
	return { ...root, ...(root.parentRootRunId ? { parentRootRunId: root.parentRootRunId } : {}), leaves: leaves as RunLeafHandle[] };
}
function copyMaybe(root: RunRootHandle | undefined) { return root ? copyRoot(root) : undefined; }
function copyLeaf(leaf: RunLeafHandle | undefined): RunLeafHandle | undefined { return leaf && { ...leaf, ...(leaf.session ? { session: { ...leaf.session } } : {}) }; }
function foreign(): ControlResolution { return { ok: false, error: ownershipError("Run is unknown or not owned by this root run.") }; }
function ownershipError(message: string): HerdrError { return { code: "unknown_or_foreign_run", message }; }
function validId(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function leafStatus(value: string | undefined): RegistryLeafStatus { return (["queued", "booting", "working", "blocked", "succeeded", "failed", "aborted", "timed_out", "lost"] as const).includes(value as RegistryLeafStatus) ? value as RegistryLeafStatus : "working"; }
function unwrap(value: unknown): unknown { return value && typeof value === "object" && "snapshot" in value ? (value as { snapshot: unknown }).snapshot : value; }
function walk(value: unknown, seen = new Set<object>(), depth = 0): Record<string, unknown>[] {
	if (depth > 12 || !value || typeof value !== "object") return [];
	if (seen.has(value)) return []; seen.add(value);
	if (Array.isArray(value)) return value.flatMap(item => walk(item, seen, depth + 1));
	const record = value as Record<string, unknown>;
	return [record, ...Object.values(record).flatMap(item => walk(item, seen, depth + 1))];
}
function id(record: Record<string, unknown>, keys: string[]): string | undefined { return text(record, keys); }
function text(record: Record<string, unknown>, keys: string[]): string | undefined { for (const key of keys) if (validId(record[key])) return record[key] as string; return undefined; }
function env(record: Record<string, unknown>): Record<string, string> {
	const found: Record<string, string> = {};
	for (const nested of [record, record.env, record.environment, record.metadata, record.meta]) if (nested && typeof nested === "object" && !Array.isArray(nested)) {
		for (const key of [ROOT_ENV, LEAF_ENV, PARENT_ENV]) if (typeof (nested as Record<string, unknown>)[key] === "string") found[key] = (nested as Record<string, string>)[key];
	}
	return found;
}
function sessionIdentity(record: Record<string, unknown>): RunSessionIdentity | undefined {
	const raw = record.piSession ?? record.pi_session ?? record.session;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const session = raw as Record<string, unknown>; const path = session.path;
	if (session.source !== "herdr:pi" || typeof path !== "string" || !path) return undefined;
	return { source: "herdr:pi", path, ...(typeof session.sessionId === "string" ? { sessionId: session.sessionId } : typeof session.session_id === "string" ? { sessionId: session.session_id } : {}) };
}
function unique<T>(items: T[], key: (item: T) => string): T[] { const found = new Map<string, T>(); for (const item of items) { const old = found.get(key(item)); if (old) continue; found.set(key(item), item); } return [...found.values()]; }
