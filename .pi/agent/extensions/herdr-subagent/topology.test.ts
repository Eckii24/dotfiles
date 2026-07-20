import { expect, test } from "bun:test";

import { acceptLeaf, addTopologyLeaf, cleanupTopology, createTopology, defaultLayout, topologyLabel, type TopologyLeaf } from "./topology.js";

type Call = [string, unknown?];
function fake(extra: { failStart?: number; failBind?: number; noLayout?: boolean; foreign?: boolean; failClose?: string } = {}) {
	const calls: Call[] = []; let starts = 0; let binds = 0; let closed = new Set<string>();
	const client = {
		async createTab(params: unknown) { calls.push(["createTab", params]); return { tab: { tab_id: "tab-1" }, root_pane: { pane_id: "bootstrap-1" } }; },
		async startAgent(params: unknown) { calls.push(["startAgent", params]); starts += 1; if (starts === extra.failStart) throw new Error("start failed"); return { pane_id: `child-${starts}` }; },
		async closePane(id: string) { calls.push(["closePane", id]); if (id === extra.failClose) throw new Error("close failed"); closed.add(id); return {}; },
		async closeTab(id: string) { calls.push(["closeTab", id]); return {}; },
		async applyLayout(params: unknown) { calls.push(["layout", params]); return {}; },
		async snapshot() { return { panes: ["child-1", "child-2", "child-3", "child-4"].filter(id => !closed.has(id)).map(pane_id => ({ pane_id, tab_id: "tab-1" })).concat(extra.foreign ? [{ pane_id: "foreign", tab_id: "tab-1" }] : []) }; },
	};
	if (extra.noLayout) delete (client as Partial<typeof client>).applyLayout;
	const capacity = {
		async reserveGroup(input: { rootRunId: string; workspaceId: string; group: string; paneCount: number }) { calls.push(["reserve", input]); return { ...input, label: `${input.group} · pi-herdr:deadbe`, provisional: true, paneIds: [] }; },
		async bindGroup(reservation: any, tabId: string, paneIds: readonly string[]) { calls.push(["bindGroup", { tabId, paneIds }]); return { ...reservation, tabId, paneIds: [...paneIds], provisional: false }; },
		async releaseGroup(reservation: unknown) { calls.push(["releaseGroup", reservation]); },
		async bindWriteLease(lease: any, paneId: string) { calls.push(["bindLease", paneId]); binds += 1; return binds === extra.failBind ? { ...lease, acquired: false } : { ...lease, paneId }; },
		async releaseWriteLease(lease: unknown) { calls.push(["releaseLease", lease]); },
	};
	return { client, capacity, calls };
}
function leaves(count: number): TopologyLeaf[] {
	return Array.from({ length: count }, (_, index) => ({ leafRunId: `leaf-${index + 1}-12345678`, launch: { executable: "/usr/local/bin/pi", name: `Worker\u001b]bad\u0007 ${index + 1}`, argv: ["--name", `child-${index + 1}`, "--append-system-prompt", `/runtime/launch-${index + 1}/prompt.md`], cwd: "/repo", env: { SAFE: "1" }, cleanupAfterReady: async () => {}, cleanupAfterFailure: async () => {} } as any, lease: { cwd: "/repo", rootRunId: "root", acquired: true } }));
}
function input(fixture: ReturnType<typeof fake>, count = 1) { return { client: fixture.client, capacity: fixture.capacity, workspaceId: "workspace-1", rootRunId: "root-12345678", group: "Plan\u001b[31m alpha", leaves: leaves(count) }; }

test("sanitizes meaningful labels with short stable IDs", () => {
	expect(topologyLabel(" \u001b]secret\u0007  Scout\n", "abcdefgh-123")).toBe("Scout · abcdefgh");
});

test("creates tab/bootstrap, starts child without focus, then closes bootstrap", async () => {
	const f = fake(); const result = await createTopology(input(f));
	expect(result.group).toMatchObject({ tabId: "tab-1", tabLabel: "Plan\u001b[31m alpha · pi-herdr:deadbe", bootstrapPaneId: undefined });
	expect([...result.group.ownedPaneIds]).toEqual(["child-1"]);
	expect(f.calls.map(call => call[0])).toEqual(["reserve", "createTab", "startAgent", "bindLease", "closePane", "bindGroup", "layout"]);
	expect(f.calls[2]![1]).toEqual({ name: "Worker 1 · leaf-1-1", argv: ["/usr/local/bin/pi", "--name", "child-1", "--append-system-prompt", "/runtime/launch-1/prompt.md"], cwd: "/repo", env: { SAFE: "1" }, tabId: "tab-1", workspaceId: "workspace-1", focus: false });
});

test("uses protocol-16 pane/split layout nodes", () => {
	expect(defaultLayout(["one", "two", "three"])).toEqual({ type: "split", direction: "right", ratio: 0.5, first: { type: "pane", pane_id: "one" }, second: { type: "split", direction: "down", ratio: 0.5, first: { type: "pane", pane_id: "two" }, second: { type: "pane", pane_id: "three" } } });
});

test("starts 1–4 leaves, binds stable pane IDs and applies exact layouts", async () => {
	for (const count of [1, 2, 3, 4]) {
		const f = fake(); const result = await createTopology(input(f, count));
		expect(result.reservation.paneIds).toEqual(Array.from({ length: count }, (_, i) => `child-${i + 1}`));
		expect(f.calls.filter(call => call[0] === "startAgent")).toHaveLength(count);
		expect(f.calls.filter(call => call[0] === "bindLease")).toHaveLength(count);
		expect(f.calls.find(call => call[0] === "layout")![1]).toMatchObject({ root: defaultLayout(result.reservation.paneIds) });
	}
});

test("rejects fifth before capacity or client side effects", async () => {
	const f = fake(); await expect(createTopology(input(f, 5))).rejects.toThrow("1–4"); expect(f.calls).toEqual([]);
});

test("rolls back only before acceptance", async () => {
	const f = fake({ failStart: 2 }); await expect(createTopology(input(f, 2))).rejects.toThrow("start failed");
	expect(f.calls.map(call => call[0])).toContain("releaseGroup");
	expect(f.calls.filter(call => call[0] === "closePane").map(call => call[1])).toEqual(["bootstrap-1", "child-1"]);
});

test("rolls back and stops before another child when acquired lease binding fails", async () => {
	const f = fake({ failBind: 1 }); await expect(createTopology(input(f, 2))).rejects.toThrow("Write lease binding failed");
	expect(f.calls.filter(call => call[0] === "startAgent")).toHaveLength(1);
	expect(f.calls.filter(call => call[0] === "closePane").map(call => call[1])).toEqual(["child-1", "bootstrap-1"]);
	expect(f.calls.map(call => call[0])).toContain("releaseLease");
	expect(f.calls.map(call => call[0])).toContain("releaseGroup");
});

test("adds a chain leaf only after initial topology exists", async () => {
	const f = fake(); const result = await createTopology({ ...input(f), paneCount: 2 });
	const pane = await addTopologyLeaf({ client: f.client, capacity: f.capacity, result, leaf: leaves(2)[1]! });
	expect(pane).toBe("child-2"); expect(result.reservation.paneIds).toEqual(["child-1", "child-2"]);
	expect(f.calls.filter(call => call[0] === "startAgent")).toHaveLength(2);
});

test("layout unsupported warns instead of failing", async () => {
	const f = fake({ noLayout: true }); const result = await createTopology(input(f));
	expect(result.warnings).toEqual(["WARNING: Herdr layout capability unavailable; leaving default pane arrangement."]);
});

test("cleanup uses stable owned IDs, preserves foreign pane tab, and is idempotent", async () => {
	const f = fake({ foreign: true }); const result = await createTopology(input(f, 2)); acceptLeaf(result.group, "leaf-1-12345678");
	expect(() => acceptLeaf(result.group, "foreign")).toThrow("not owned");
	const first = await cleanupTopology({ client: f.client, capacity: f.capacity, result }); const second = await cleanupTopology({ client: f.client, capacity: f.capacity, result });
	expect(first).toContain("WARNING: foreign pane present; tab left open."); expect(f.calls.filter(call => call[0] === "closeTab")).toHaveLength(0);
	expect(f.calls.filter(call => call[0] === "closePane").map(call => call[1])).toEqual(["bootstrap-1", "child-1", "child-2"]);
	expect(second).toContain("WARNING: foreign pane present; tab left open.");
});

test("cleanup warns on close failure and keeps failed stable ownership", async () => {
	const f = fake({ failClose: "child-1" }); const result = await createTopology(input(f));
	const warnings = await cleanupTopology({ client: f.client, capacity: f.capacity, result });
	expect(warnings).toContain("WARNING: failed to close owned pane child-1."); expect(result.group.ownedPaneIds.has("child-1")).toBe(true);
});

test("cleanup re-snapshots before tab close and preserves a newly inserted foreign pane", async () => {
	const f = fake(); const result = await createTopology(input(f, 4)); let snapshots = 0;
	f.client.snapshot = async () => ++snapshots === 1 ? { panes: [...result.group.ownedPaneIds].map(pane_id => ({ pane_id, tab_id: "tab-1" })) } : { panes: [{ pane_id: "foreign", tab_id: "tab-1" }] };
	const warnings = await cleanupTopology({ client: f.client, capacity: f.capacity, result });
	expect(warnings).toContain("WARNING: foreign pane present; tab left open."); expect(f.calls.filter(call => call[0] === "closeTab")).toHaveLength(0);
});

test("cleanup accepts Herdr auto-removing the tab after its final pane closes", async () => {
	const f = fake(); const result = await createTopology(input(f)); let snapshots = 0;
	f.client.snapshot = async () => ++snapshots === 1 ? { tabs: [{ tab_id: "tab-1" }], panes: [{ pane_id: "child-1", tab_id: "tab-1" }] } : { tabs: [], panes: [] };
	const warnings = await cleanupTopology({ client: f.client, capacity: f.capacity, result });
	expect(warnings).toEqual([]); expect(f.calls.filter(call => call[0] === "closeTab")).toHaveLength(0);
});
