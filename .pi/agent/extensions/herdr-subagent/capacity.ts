import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ErrorCode } from "./contracts.js";

export const MAX_MANAGED_TABS = 3;
export const MAX_GROUP_PANES = 4;
export const MANAGED_LABEL_MARKER = " · pi-herdr:";
const LOCK_STALE_MS = 10_000;
const LOCK_TIMEOUT_MS = 2_000;
export const PROVISIONAL_TTL_MS = 30_000;

type Stat = { isDirectory(): boolean; isSymbolicLink(): boolean; uid: number; mode: number; mtimeMs: number };
type SnapshotTab = { tab_id?: string; id?: string; workspace_id?: string; workspaceId?: string; label?: string; name?: string };
type SnapshotPane = { pane_id?: string; id?: string; tab_id?: string; tabId?: string };
export type CapacitySnapshot = { tabs?: SnapshotTab[]; panes?: SnapshotPane[] };
export type CapacityDependencies = {
	env?: Readonly<Record<string, string | undefined>>; uid?: number; runtimeRoot?: string;
	clock?: () => number; pid?: number; randomToken?: () => string; processAlive?: (pid: number) => boolean; snapshot: () => Promise<CapacitySnapshot>;
	mkdir?: typeof mkdir; chmod?: typeof chmod; lstat?: (path: string) => Promise<Stat>; readFile?: typeof readFile;
	writeFile?: typeof writeFile; rename?: typeof rename; rm?: typeof rm; realpath?: typeof realpath;
};
type ReservationRecord = { rootRunId: string; workspaceId: string; tabId?: string; paneIds: string[]; createdAt: number };
type LeaseRecord = { rootRunId: string; cwd: string; createdAt: number; paneId?: string };
type LockRecord = { pid: number; token: string };
type State = { reservations: ReservationRecord[] };

export class CapacityError extends Error {
	constructor(readonly code: Extract<ErrorCode, "tab_capacity_exceeded" | "pane_capacity_exceeded" | "shared_workspace_write_conflict">, message: string) { super(message); this.name = "CapacityError"; }
}
export type CapacityReservation = { rootRunId: string; workspaceId: string; label: string; paneCount: number; provisional: boolean; tabId?: string; paneIds: string[] };
export type WriteLease = { cwd: string; rootRunId: string; acquired: boolean; paneId?: string; warning?: string };

/** Stable suffix is discovery aid only; caller must also validate Herdr ownership metadata. */
export function managedTabSuffix(rootRunId: string): string {
	if (!rootRunId || /[\p{C}]/u.test(rootRunId)) throw new TypeError("rootRunId is invalid");
	return `${MANAGED_LABEL_MARKER}${createHash("sha256").update(rootRunId).digest("hex").slice(0, 6)}`;
}
export function managedTabLabel(group: string, rootRunId: string): string {
	const name = group.replace(/[\p{C}]/gu, "").replaceAll(rootRunId, "").trim();
	return `${name}${managedTabSuffix(rootRunId)}`;
}
export function managedRunIdFromLabel(label: string): string | undefined {
	const at = label.lastIndexOf(MANAGED_LABEL_MARKER); const id = at < 0 ? "" : label.slice(at + MANAGED_LABEL_MARKER.length);
	return /^[a-f0-9]{6}$/.test(id) ? id : undefined;
}
/** Declared-tool classification, not sandboxing or proof of eventual file writes. */
export function isDeclaredWriter(tools: readonly string[] | undefined): boolean { return tools?.some(tool => tool === "edit" || tool === "write") ?? false; }

export class CapacityCoordinator {
	private readonly root: string; private readonly now: () => number;
	constructor(private readonly d: CapacityDependencies) {
		const uid = d.uid ?? process.getuid?.() ?? 0;
		this.root = join(d.runtimeRoot ?? d.env?.XDG_RUNTIME_DIR ?? tmpdir(), `pi-herdr-subagent-${uid}`);
		this.now = d.clock ?? Date.now;
	}
	async reserveGroup(input: { workspaceId: string; rootRunId: string; group: string; paneCount: number }): Promise<CapacityReservation> {
		if (!Number.isInteger(input.paneCount) || input.paneCount < 1 || input.paneCount > MAX_GROUP_PANES) throw new CapacityError("pane_capacity_exceeded", `A managed group permits 1–${MAX_GROUP_PANES} panes.`);
		return this.locked(async () => {
			const snapshot = capacitySnapshot(await this.d.snapshot()); const state = await this.reconciled(snapshot);
			const tabs = managedTabs(snapshot, state, input.workspaceId);
			// Snapshot labels conservatively reserve capacity; they never establish ownership.
			const existing = state.reservations.filter(r => r.workspaceId === input.workspaceId && !r.tabId);
			if (tabs.size + existing.length >= MAX_MANAGED_TABS) throw new CapacityError("tab_capacity_exceeded", `Workspace already has ${MAX_MANAGED_TABS} managed tabs.`);
			state.reservations.push({ rootRunId: input.rootRunId, workspaceId: input.workspaceId, paneIds: [], createdAt: this.now() });
			await this.saveState(state);
			return { rootRunId: input.rootRunId, workspaceId: input.workspaceId, label: managedTabLabel(input.group, input.rootRunId), paneCount: input.paneCount, provisional: true, paneIds: [] };
		});
	}
	async bindGroup(reservation: CapacityReservation, tabId: string, paneIds: readonly string[]): Promise<CapacityReservation> {
		if (!tabId || paneIds.length > MAX_GROUP_PANES) throw new CapacityError("pane_capacity_exceeded", `A managed group permits at most ${MAX_GROUP_PANES} panes.`);
		return this.locked(async () => {
			const state = await this.loadState(); const item = state.reservations.find(r => r.rootRunId === reservation.rootRunId && r.workspaceId === reservation.workspaceId);
			if (!item) throw new CapacityError("tab_capacity_exceeded", "Capacity reservation no longer exists.");
			item.tabId = tabId; item.paneIds = [...paneIds]; await this.saveState(state);
			return { ...reservation, provisional: false, tabId, paneIds: [...paneIds] };
		});
	}
	async releaseGroup(reservation: Pick<CapacityReservation, "rootRunId" | "workspaceId">): Promise<void> {
		await this.locked(async () => { const state = await this.loadState(); state.reservations = state.reservations.filter(r => !(r.rootRunId === reservation.rootRunId && r.workspaceId === reservation.workspaceId)); await this.saveState(state); });
	}
	async acquireWriteLease(input: { cwd: string; rootRunId: string; tools?: readonly string[]; allowSharedWorkspaceWrites?: boolean }): Promise<WriteLease> {
		const cwd = await (this.d.realpath ?? realpath)(input.cwd);
		if (!isDeclaredWriter(input.tools)) return { cwd, rootRunId: input.rootRunId, acquired: false };
		return this.locked(async () => {
			const file = this.leasePath(cwd); let current = await this.readLease(file);
			if (current && !(await this.liveLease(current, capacitySnapshot(await this.d.snapshot())))) { await (this.d.rm ?? rm)(file, { force: true }); current = undefined; }
			if (current && current.rootRunId !== input.rootRunId) {
				if (!input.allowSharedWorkspaceWrites) throw new CapacityError("shared_workspace_write_conflict", "Another declared writer holds this canonical cwd lease.");
				return { cwd, rootRunId: input.rootRunId, acquired: false, warning: "WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict." };
			}
			if (!current) { current = { rootRunId: input.rootRunId, cwd, createdAt: this.now() }; await this.atomicWrite(file, JSON.stringify(current)); }
			return { cwd, rootRunId: input.rootRunId, acquired: true, paneId: current.paneId };
		});
	}
	async bindWriteLease(lease: WriteLease, paneId: string): Promise<WriteLease> {
		if (!lease.acquired || !paneId) return lease;
		return this.locked(async () => {
			const file = this.leasePath(lease.cwd); const current = await this.readLease(file);
			if (!current || current.rootRunId !== lease.rootRunId || current.paneId) return { ...lease, acquired: false };
			const bound = { ...current, paneId } satisfies LeaseRecord; await this.atomicWrite(file, JSON.stringify(bound));
			return { ...lease, paneId };
		});
	}
	async releaseWriteLease(lease: WriteLease): Promise<void> {
		if (!lease.acquired) return;
		await this.locked(async () => { const file = this.leasePath(lease.cwd); const current = await this.readLease(file); if (current?.rootRunId === lease.rootRunId && current.paneId === lease.paneId) await (this.d.rm ?? rm)(file, { force: true }); });
	}
	private async runtime() {
		try { await (this.d.mkdir ?? mkdir)(this.root, { recursive: true, mode: 0o700 }); await (this.d.chmod ?? chmod)(this.root, 0o700); const info = await (this.d.lstat ?? lstat)(this.root) as Stat; const uid = this.d.uid ?? process.getuid?.();
			if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid) || (info.mode & 0o777) !== 0o700) throw new Error(); }
		catch { throw new CapacityError("tab_capacity_exceeded", "Cannot use current-user Pi Herdr runtime directory."); }
	}
	private async locked<T>(fn: () => Promise<T>): Promise<T> {
		await this.runtime(); const lock = join(this.root, "capacity.lock"); const owner = join(lock, "owner.json"); const deadline = this.now() + LOCK_TIMEOUT_MS;
		const record: LockRecord = { pid: this.d.pid ?? process.pid, token: (this.d.randomToken ?? randomUUID)() };
		for (;;) { try { await (this.d.mkdir ?? mkdir)(lock, { mode: 0o700 }); await (this.d.writeFile ?? writeFile)(owner, JSON.stringify(record), { mode: 0o600 }); break; } catch {
			try { const stat = await (this.d.lstat ?? lstat)(lock) as Stat; const current = await this.readLock(owner); if (this.now() - stat.mtimeMs > LOCK_STALE_MS && (!current || !this.alive(current.pid))) {
				// Re-read same token before removal: never delete a replacement lock.
				const verify = await this.readLock(owner); if (!current ? !verify : verify?.token === current.token) await (this.d.rm ?? rm)(lock, { recursive: true, force: true });
			} else if (this.now() >= deadline) throw new CapacityError("tab_capacity_exceeded", "Timed out waiting for capacity lock."); } catch (error) { if (error instanceof CapacityError) throw error; }
			await new Promise(resolve => setTimeout(resolve, 5));
		} }
		try { return await fn(); } finally { const current = await this.readLock(owner); if (current?.token === record.token) await (this.d.rm ?? rm)(lock, { recursive: true, force: true }); }
	}
	private alive(pid: number) { if (this.d.processAlive) return this.d.processAlive(pid); try { process.kill(pid, 0); return true; } catch { return false; } }
	private async readLock(path: string): Promise<LockRecord | undefined> { try { const x: unknown = JSON.parse(await (this.d.readFile ?? readFile)(path, "utf8")); return !!x && typeof x === "object" && Number.isInteger((x as LockRecord).pid) && (x as LockRecord).pid > 0 && typeof (x as LockRecord).token === "string" && !!(x as LockRecord).token ? x as LockRecord : undefined; } catch { return undefined; } }
	private async reconciled(snapshot: CapacitySnapshot): Promise<State> { const state = await this.loadState(); const tabs = allTabIds(snapshot); const now = this.now(); state.reservations = state.reservations.filter(r => r.tabId ? tabs.has(r.tabId) : now - r.createdAt <= PROVISIONAL_TTL_MS); await this.saveState(state); return state; }
	private async liveLease(lease: LeaseRecord, snapshot: CapacitySnapshot) { return lease.paneId ? allPaneIds(snapshot).has(lease.paneId) : this.now() - lease.createdAt <= PROVISIONAL_TTL_MS; }
	private async loadState(): Promise<State> { try { const parsed: unknown = JSON.parse(await (this.d.readFile ?? readFile)(join(this.root, "capacity.json"), "utf8")); if (typeof parsed === "object" && parsed && Array.isArray((parsed as State).reservations)) return { reservations: (parsed as State).reservations.filter(validReservation) }; } catch { /* absent/corrupt state is empty; snapshot remains authority */ } return { reservations: [] }; }
	private saveState(state: State) { return this.atomicWrite(join(this.root, "capacity.json"), JSON.stringify({ reservations: state.reservations })); }
	private async atomicWrite(path: string, body: string) { const temporary = `${path}.${randomUUID()}.tmp`; await (this.d.writeFile ?? writeFile)(temporary, body, { mode: 0o600 }); await (this.d.rename ?? rename)(temporary, path); }
	private async readLease(path: string): Promise<LeaseRecord | undefined> { try { const value: unknown = JSON.parse(await (this.d.readFile ?? readFile)(path, "utf8")); return validLease(value) ? value : undefined; } catch { return undefined; } }
	private leasePath(cwd: string) { return join(this.root, `write-${createHash("sha256").update(cwd).digest("hex")}.json`); }
}
function validReservation(value: unknown): value is ReservationRecord { const x = value as ReservationRecord; return !!x && typeof x.rootRunId === "string" && typeof x.workspaceId === "string" && Array.isArray(x.paneIds) && (x.tabId === undefined || typeof x.tabId === "string"); }
function validLease(value: unknown): value is LeaseRecord { const x = value as LeaseRecord; return !!x && typeof x.rootRunId === "string" && typeof x.cwd === "string" && typeof x.createdAt === "number" && (x.paneId === undefined || typeof x.paneId === "string"); }
function capacitySnapshot(value: unknown): CapacitySnapshot {
	const outer = value as { snapshot?: unknown; result?: { snapshot?: unknown } };
	const body = outer?.snapshot ?? outer?.result?.snapshot ?? value;
	return body && typeof body === "object" ? body as CapacitySnapshot : {};
}
function tabId(tab: SnapshotTab) { return tab.tab_id ?? tab.id; }
function paneId(pane: SnapshotPane) { return pane.pane_id ?? pane.id; }
function allTabIds(snapshot: CapacitySnapshot) { return new Set((snapshot.tabs ?? []).map(tabId).filter((id): id is string => typeof id === "string")); }
function allPaneIds(snapshot: CapacitySnapshot) { return new Set((snapshot.panes ?? []).map(paneId).filter((id): id is string => typeof id === "string")); }
function managedTabs(snapshot: CapacitySnapshot, state: State, workspaceId: string) {
	const visible = allTabIds(snapshot);
	const labeled = (snapshot.tabs ?? []).filter(tab => (tab.workspace_id ?? tab.workspaceId) === workspaceId && typeof tabId(tab) === "string" && typeof tab.label === "string" && managedRunIdFromLabel(tab.label)).map(tab => tabId(tab)!);
	const realized = state.reservations.filter(r => r.workspaceId === workspaceId && !!r.tabId && visible.has(r.tabId)).map(r => r.tabId!);
	return new Set([...labeled, ...realized]);
}
