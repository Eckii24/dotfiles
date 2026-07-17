import { expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CapacityCoordinator, CapacityError, MANAGED_LABEL_MARKER, PROVISIONAL_TTL_MS, managedRunIdFromLabel, managedTabLabel, managedTabSuffix, isDeclaredWriter } from "./capacity.js";

function fixture() { const root = mkdtempSync(join(tmpdir(), "pi-herdr-capacity-")); const runtime = join(root, "runtime"); const cwd = join(root, "cwd"); mkdirSync(runtime); mkdirSync(cwd); return { root, runtime, cwd }; }
function snapshot(tabs: object[] = [], panes: object[] = []) { return async () => ({ tabs, panes }); }
function coordinator(runtimeRoot: string, get = snapshot()) { return new CapacityCoordinator({ runtimeRoot, uid: process.getuid?.(), snapshot: get }); }

test("uses a 0700 current-user runtime directory, stable short managed suffix, and stores no task/output", async () => {
	const f = fixture(); try {
		const c = coordinator(f.runtime); const rootRunId = "123e4567-e89b-12d3-a456-426614174000"; const r = await c.reserveGroup({ workspaceId: "w", rootRunId, group: `Build ${rootRunId}`, paneCount: 4 }); const label = r.label;
		expect(r.provisional).toBeTrue(); expect(managedTabSuffix(rootRunId)).toBe(`${MANAGED_LABEL_MARKER}986c0d`); expect(label).toBe(`Build${managedTabSuffix(rootRunId)}`); expect(managedRunIdFromLabel(label)).toBe("986c0d"); expect(label).not.toContain(rootRunId);
		expect(lstatSync(join(f.runtime, `pi-herdr-subagent-${process.getuid?.()}`)).mode & 0o777).toBe(0o700);
		expect(readFileSync(join(f.runtime, `pi-herdr-subagent-${process.getuid?.()}`, "capacity.json"), "utf8")).not.toContain("prompt");
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "bad", group: "x", paneCount: 5 })).rejects.toMatchObject({ code: "pane_capacity_exceeded" });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("fresh snapshot allows three managed tabs, rejects fourth, and reconciles stale real IDs", async () => {
	const f = fixture(); try {
		let tabs: object[] = []; const c = coordinator(f.runtime, async () => ({ tabs }));
		for (const id of ["one", "two", "three"]) { const r = await c.reserveGroup({ workspaceId: "w", rootRunId: id, group: id, paneCount: 1 }); await c.bindGroup(r, `tab-${id}`, []); tabs.push({ tab_id: `tab-${id}`, workspace_id: "w", label: r.label }); }
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
		tabs = []; // Herdr restart/close: next allocation must prune old real reservations.
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).resolves.toMatchObject({ provisional: true });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("fresh state conservatively counts three labeled workspace tabs, not an unlabeled foreign tab", async () => {
	const f = fixture(); try {
		const tabs = [
			...(["one", "two", "three"] as const).map(id => ({ tab_id: `tab-${id}`, workspace_id: "w", label: managedTabLabel(id, id) })),
			{ tab_id: "foreign", workspace_id: "w", label: "foreign" },
		];
		const c = coordinator(f.runtime, snapshot(tabs));
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("Herdr snapshot envelope counts three labeled tabs before fourth allocation", async () => {
	const f = fixture(); try {
		const tabs = (["one", "two", "three"] as const).map(id => ({ tab_id: `tab-${id}`, workspace_id: "w", label: managedTabLabel(id, id) }));
		const c = coordinator(f.runtime, async () => ({ type: "session_snapshot", snapshot: { tabs, panes: [] } }) as any);
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("concurrent allocators cannot claim final slot across coordinators", async () => {
	const f = fixture(); try {
		let tabs: object[] = []; const one = coordinator(f.runtime, async () => ({ tabs })); const two = coordinator(f.runtime, async () => ({ tabs }));
		for (const id of ["a", "b"]) { const reservation = await one.reserveGroup({ workspaceId: "w", rootRunId: id, group: id, paneCount: 1 }); await one.bindGroup(reservation, id, []); tabs.push({ tab_id: id, workspace_id: "w", label: managedTabLabel(id, id) }); }
		const results = await Promise.allSettled([one.reserveGroup({ workspaceId: "w", rootRunId: "one", group: "one", paneCount: 1 }), two.reserveGroup({ workspaceId: "w", rootRunId: "two", group: "two", paneCount: 1 })]);
		expect(results.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(results.filter(x => x.status === "rejected")[0]?.reason).toBeInstanceOf(CapacityError);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("bash-only scouts are not declared writers; classification is not sandboxing", () => {
	expect(isDeclaredWriter(["bash"])).toBeFalse(); expect(isDeclaredWriter(["edit"])).toBeTrue(); expect(isDeclaredWriter(["write"])).toBeTrue();
});

test("symlink aliases collide on canonical cwd, override warns, and release permits reacquire", async () => {
	const f = fixture(); try {
		const alias = join(f.root, "alias"); symlinkSync(f.cwd, alias); let panes: object[] = []; const c = coordinator(f.runtime, async () => ({ panes }));
		const first = await c.acquireWriteLease({ cwd: f.cwd, rootRunId: "writer-1", tools: ["edit"] }); panes = [{ pane_id: "retained-pane" }]; const settled = await c.bindWriteLease(first, "retained-pane");
		await expect(c.acquireWriteLease({ cwd: alias, rootRunId: "writer-2", tools: ["write"] })).rejects.toMatchObject({ code: "shared_workspace_write_conflict" });
		const shared = await c.acquireWriteLease({ cwd: alias, rootRunId: "writer-2", tools: ["write"], allowSharedWorkspaceWrites: true }); expect(shared.warning).toBe("WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict.");
		await c.releaseWriteLease(settled); const second = await c.acquireWriteLease({ cwd: alias, rootRunId: "writer-2", tools: ["write"] }); expect(second.acquired).toBeTrue(); await c.releaseWriteLease(second);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("different canonical cwd values and nested parent roots receive independent/conflicting leases", async () => {
	const f = fixture(); try {
		const other = join(f.root, "other"); mkdirSync(other); const c = coordinator(f.runtime);
		const parent = await c.acquireWriteLease({ cwd: f.cwd, rootRunId: "parent", tools: ["edit"] });
		await expect(c.acquireWriteLease({ cwd: f.cwd, rootRunId: "nested-child", tools: ["write"] })).rejects.toMatchObject({ code: "shared_workspace_write_conflict" });
		const separate = await c.acquireWriteLease({ cwd: other, rootRunId: "nested-child", tools: ["write"] }); expect(separate.acquired).toBeTrue();
		await c.releaseWriteLease(parent); await c.releaseWriteLease(separate);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("separate Bun processes serialize final-slot allocation through filesystem lock", async () => {
	const f = fixture(); try {
		const seed = coordinator(f.runtime); await seed.reserveGroup({ workspaceId: "w", rootRunId: "one", group: "one", paneCount: 1 }); await seed.reserveGroup({ workspaceId: "w", rootRunId: "two", group: "two", paneCount: 1 });
		const moduleUrl = pathToFileURL(join(import.meta.dir, "capacity.ts")).href;
		const script = `import { CapacityCoordinator } from ${JSON.stringify(moduleUrl)}; const c = new CapacityCoordinator({ runtimeRoot: process.env.RUNTIME, uid: Number(process.env.UID), snapshot: async () => ({}) }); try { await c.reserveGroup({ workspaceId: "w", rootRunId: process.env.RUN, group: "x", paneCount: 1 }); process.stdout.write("ok"); } catch (error) { process.stdout.write((error as any).code || "error"); }`;
		const spawn = (run: string) => Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, RUNTIME: f.runtime, UID: String(process.getuid?.() ?? 0), RUN: run }, stdout: "pipe", stderr: "pipe" });
		const children = [spawn("three"), spawn("four")]; const results = await Promise.all(children.map(async child => (await new Response(child.stdout).text()).trim()));
		expect(results.filter(result => result === "ok")).toHaveLength(1); expect(results.filter(result => result === "tab_capacity_exceeded")).toHaveLength(1);
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("separate Bun processes reject a second declared writer on the same canonical cwd", async () => {
	const f = fixture(); let child: ReturnType<typeof Bun.spawn> | undefined;
	try {
		const moduleUrl = pathToFileURL(join(import.meta.dir, "capacity.ts")).href;
		const script = `import { CapacityCoordinator } from ${JSON.stringify(moduleUrl)}; const c = new CapacityCoordinator({ runtimeRoot: process.env.RUNTIME, uid: Number(process.env.UID), snapshot: async () => ({}) }); await c.acquireWriteLease({ cwd: process.env.CWD, rootRunId: "other-pi-worker", tools: ["edit"] }); process.stdout.write("ready"); await Bun.sleep(30_000);`;
		child = Bun.spawn([process.execPath, "-e", script], { env: { ...process.env, RUNTIME: f.runtime, UID: String(process.getuid?.() ?? 0), CWD: f.cwd }, stdout: "pipe", stderr: "pipe" });
		const reader = child.stdout.getReader(); const ready = await reader.read(); reader.releaseLock();
		expect(new TextDecoder().decode(ready.value)).toBe("ready");
		await expect(coordinator(f.runtime).acquireWriteLease({ cwd: f.cwd, rootRunId: "this-pi-worker", tools: ["write"] })).rejects.toMatchObject({ code: "shared_workspace_write_conflict" });
	} finally { child?.kill(); await child?.exited; rmSync(f.root, { recursive: true, force: true }); }
});

test("recovers crash-left provisional write leases after bounded TTL", async () => {
	const f = fixture(); try {
		let now = 0; const c = new CapacityCoordinator({ runtimeRoot: f.runtime, uid: process.getuid?.(), clock: () => now, snapshot: snapshot() });
		await c.acquireWriteLease({ cwd: f.cwd, rootRunId: "crashed", tools: ["edit"] });
		now = PROVISIONAL_TTL_MS + 1;
		await expect(c.acquireWriteLease({ cwd: f.cwd, rootRunId: "recovered", tools: ["write"] })).resolves.toMatchObject({ acquired: true });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("recovers crash-left provisional group reservations after bounded TTL", async () => {
	const f = fixture(); try {
		let now = 0; const c = new CapacityCoordinator({ runtimeRoot: f.runtime, uid: process.getuid?.(), clock: () => now, snapshot: snapshot() });
		for (const id of ["one", "two", "three"]) await c.reserveGroup({ workspaceId: "w", rootRunId: id, group: id, paneCount: 1 });
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
		now = PROVISIONAL_TTL_MS + 1;
		await expect(c.reserveGroup({ workspaceId: "w", rootRunId: "four", group: "four", paneCount: 1 })).resolves.toMatchObject({ provisional: true });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("recovers absent bound panes but preserves live bound write conflicts", async () => {
	const f = fixture(); try {
		let panes: object[] = [{ pane_id: "owned-pane" }]; const c = coordinator(f.runtime, async () => ({ panes }));
		const first = await c.acquireWriteLease({ cwd: f.cwd, rootRunId: "writer-1", tools: ["edit"] }); await c.bindWriteLease(first, "owned-pane");
		await expect(c.acquireWriteLease({ cwd: f.cwd, rootRunId: "writer-2", tools: ["write"] })).rejects.toMatchObject({ code: "shared_workspace_write_conflict" });
		panes = [];
		await expect(c.acquireWriteLease({ cwd: f.cwd, rootRunId: "writer-2", tools: ["write"] })).resolves.toMatchObject({ acquired: true });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("recovers bounded stale lock and times out on live lock", async () => {
	const f = fixture(); try {
		const dir = join(f.runtime, `pi-herdr-subagent-${process.getuid?.()}`); mkdirSync(dir); const lock = join(dir, "capacity.lock"); mkdirSync(lock); utimesSync(lock, 0, 0);
		const stale = coordinator(f.runtime, snapshot()); await expect(stale.reserveGroup({ workspaceId: "w", rootRunId: "x", group: "x", paneCount: 1 })).resolves.toBeDefined();
		mkdirSync(lock); writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, token: "live-owner" })); utimesSync(lock, 0, 0); let tick = 0; const clock = () => (tick += 1_000); const live = new CapacityCoordinator({ runtimeRoot: f.runtime, uid: process.getuid?.(), clock, snapshot: snapshot() });
		await expect(live.reserveGroup({ workspaceId: "w", rootRunId: "y", group: "y", paneCount: 1 })).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
	} finally { rmSync(f.root, { recursive: true, force: true }); }
});
