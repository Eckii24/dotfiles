import { expect, test } from "bun:test";

import { managedTabLabel, managedTabSuffix } from "./capacity.js";
import { RunRegistry, hasRunTabSuffix, runTabSuffix } from "./run-registry.js";

const rootId = "root-12345678-full";
const childId = "child-12345678-full";
const leafId = "leaf-12345678-full";
function root(overrides: Record<string, unknown> = {}) {
	return { rootRunId: rootId, workspaceId: "workspace-1", tabId: "tab-1", tabLabel: managedTabLabel("Plan", rootId), status: "working" as const, keepOpen: true, leaves: [{ leafRunId: leafId, paneId: "pane-1", status: "working" as const, session: { source: "herdr:pi" as const, path: "/safe/session.jsonl", sessionId: "session-1" } }], ...overrides };
}
function snapshot(input: { tabId?: string; label?: string; root?: string; leaf?: string; paneId?: string; duplicateTab?: boolean; duplicateLeaf?: boolean } = {}) {
	const tabId = input.tabId ?? "tab-1"; const label = input.label ?? managedTabLabel("Plan", rootId);
	const agent = { tab_id: tabId, pane_id: input.paneId ?? "pane-1", state: "done", env: { PI_HERDR_ROOT_RUN_ID: input.root ?? rootId, PI_HERDR_LEAF_RUN_ID: input.leaf ?? leafId, PI_HERDR_PARENT_ROOT_RUN_ID: "parent-12345678-full" }, session: { source: "herdr:pi", path: "/safe/session.jsonl", session_id: "session-1" } };
	return { snapshot: { tabs: [{ tab_id: tabId, label, workspace_id: "workspace-1" }, ...(input.duplicateTab ? [{ tab_id: "tab-2", label }] : [])], agents: [agent, ...(input.duplicateLeaf ? [{ ...agent, pane_id: "pane-2" }] : [])] } };
}

test("registers, updates, and returns root/leaf handles without exposing mutable state", () => {
	const registry = new RunRegistry(); registry.register(root());
	expect(registry.updateRoot(rootId, { status: "blocked" })?.status).toBe("blocked");
	expect(registry.updateLeaf(rootId, leafId, { status: "succeeded" })?.session?.sessionId).toBe("session-1");
	const returned = registry.get(rootId)!; returned.leaves[0]!.paneId = "tampered";
	expect(registry.getLeaf(rootId, leafId)?.paneId).toBe("pane-1");
});

test("top parent controls registered descendants; child cannot control parent or sibling", () => {
	const registry = new RunRegistry(); registry.register(root());
	registry.register(root({ rootRunId: childId, parentRootRunId: rootId, tabId: "tab-child", tabLabel: managedTabLabel("Nested", childId), leaves: [{ leafRunId: "child-leaf-full", paneId: "child-pane", status: "working" }] }));
	registry.register(root({ rootRunId: "sibling-full", parentRootRunId: rootId, tabId: "tab-sibling", tabLabel: "Sibling · sibling-", leaves: [{ leafRunId: "sibling-leaf", paneId: "sibling-pane", status: "working" }] }));
	expect(registry.resolveControl(rootId, childId, "child-leaf-full").ok).toBe(true);
	expect(registry.resolveControl(childId, rootId).ok).toBe(false);
	expect(registry.resolveControl(childId, "sibling-full").ok).toBe(false);
	expect(registry.resolveControl(rootId, "foreign").ok).toBe(false);
});

test("recovers only a uniquely suffixed tab plus matching full PI_HERDR IDs", () => {
	const registry = new RunRegistry(); const result = registry.recover(rootId, snapshot());
	expect(result.status).toBe("recovered");
	if (result.status === "recovered") expect(result.root).toMatchObject({ rootRunId: rootId, parentRootRunId: "parent-12345678-full", tabId: "tab-1", leaves: [{ leafRunId: leafId, paneId: "pane-1", status: "working", session: { sessionId: "session-1" } }] });
	expect(runTabSuffix(rootId)).toBe(managedTabSuffix(rootId)); expect(hasRunTabSuffix(managedTabLabel("Plan", rootId), rootId)).toBe(true);
});

test("labels alone, incomplete PI_HERDR metadata, collisions, and duplicate leaf claims fail closed", () => {
	const registry = new RunRegistry();
	const label = managedTabLabel("Plan", rootId);
	const labelsOnly = { snapshot: { tabs: [{ tab_id: "tab-1", label }], agents: [{ tab_id: "tab-1", pane_id: "pane-1" }] } };
	const rootOnly = { snapshot: { tabs: [{ tab_id: "tab-1", label }], agents: [{ tab_id: "tab-1", pane_id: "pane-1", env: { PI_HERDR_ROOT_RUN_ID: rootId } }] } };
	expect(registry.recover(rootId, labelsOnly).status).toBe("unowned");
	expect(registry.recover(rootId, rootOnly).status).toBe("unowned");
	expect(registry.recover(rootId, snapshot({ duplicateTab: true })).status).toBe("unowned");
	expect(registry.recover(rootId, snapshot({ duplicateLeaf: true })).status).toBe("unowned");
});

test("state loss recovers from snapshot; missing live objects becomes lost, never completion", () => {
	const registry = new RunRegistry(); registry.register(root());
	expect(registry.recover(rootId, snapshot()).status).toBe("recovered");
	const missing = registry.recover(rootId, { snapshot: { tabs: [], agents: [] } });
	expect(missing.status).toBe("lost");
	if (missing.status === "lost") expect(missing.root.leaves[0]!.status).toBe("lost");
});

test("atomic follow-up claim permits one caller and terminal marker clearing prevents stale collection", () => {
	const registry = new RunRegistry(); registry.register(root({ status: "succeeded", leaves: [{ leafRunId: leafId, paneId: "pane-1", status: "succeeded", session: { source: "herdr:pi", path: "/safe/session.jsonl", sessionId: "session-1" } }] }));
	const claims = [registry.claimFollowUp(rootId, leafId, "turn-1", "marker-1"), registry.claimFollowUp(rootId, leafId, "turn-2", "marker-2")];
	expect(claims.filter(Boolean)).toHaveLength(1); expect(registry.getLeaf(rootId, leafId)).toMatchObject({ status: "working", activeTurnId: "turn-1" });
	registry.updateLeaf(rootId, leafId, { status: "succeeded", activeTurnId: undefined, activeMarker: undefined });
	expect(registry.getLeaf(rootId, leafId)).toMatchObject({ status: "succeeded", activeTurnId: undefined, activeMarker: undefined });
});

test("retained handles remain controllable; successful close removes local authority", () => {
	const registry = new RunRegistry(); registry.register(root({ status: "succeeded", keepOpen: true }));
	expect(registry.resolveControl(rootId, rootId, leafId).ok).toBe(true);
	expect(registry.close(rootId)).toBe(true);
	expect(registry.resolveControl(rootId, rootId).ok).toBe(false);
});
