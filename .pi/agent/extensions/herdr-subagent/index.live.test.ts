import { expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHerdrSubagentRuntime, lifecyclePort, sessionPort } from "./index.js";
import { createHerdrSubagentControlRuntime } from "./control.js";
import { checkPreconditions } from "./preconditions.js";
import { HerdrClient } from "./herdr-client.js";
import { createTopology, type TopologyResult } from "./topology.js";
import { CapacityCoordinator } from "./capacity.js";
import { validatePiSessionRef } from "./pi-session.js";

const live = process.env.HERDR_G3_LIVE === "1";
const groupLive = process.env.HERDR_G13_LIVE === "1";
const g4Live = process.env.HERDR_G4_LIVE === "1";
const g2Live = process.env.HERDR_G2_LIVE === "1";
const g5Live = process.env.HERDR_G5_LIVE === "1";
const g16Live = process.env.HERDR_G16_LIVE === "1";
const g19Live = process.env.HERDR_G19_LIVE === "1";
const socketPath = process.env.HERDR_SOCKET_PATH;
const runtimeRoot = join(process.env.XDG_RUNTIME_DIR || "/tmp", `pi-herdr-subagent-${process.getuid?.() ?? "user"}`);
const sessionRoot = join(homedir(), ".pi", "agent", "sessions");

async function names(prefix: string) {
	try { return (await readdir(runtimeRoot)).filter(name => name.startsWith(prefix)).sort(); }
	catch { return []; }
}
function body(value: any) { return value?.snapshot ?? value?.result?.snapshot ?? value; }
function tabIds(value: any) { return new Set((body(value)?.tabs ?? []).map((tab: any) => tab.tab_id ?? tab.id).filter(Boolean)); }
function paneIds(value: any) { return new Set((body(value)?.panes ?? []).map((pane: any) => pane.pane_id ?? pane.id).filter(Boolean)); }
async function git(cwd: string, ...args: string[]) { const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" }); const output = await new Response(child.stdout).text(); const error = await new Response(child.stderr).text(); if (await child.exited) throw new Error(`git ${args.join(" ")}: ${error}`); return output; }
async function disposableRepo(root: string, name: string) { const cwd = join(root, name); await git(root, "init", "--", cwd); await git(cwd, "config", "user.email", "g16@example.invalid"); await git(cwd, "config", "user.name", "G16"); await writeFile(join(cwd, "baseline.txt"), "baseline\n"); await git(cwd, "add", "baseline.txt"); await git(cwd, "commit", "-m", "baseline"); return cwd; }
async function waitFor(label: string, condition: () => boolean | Promise<boolean>, timeoutMs = 30_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out waiting for ${label}`); }
function nestedPaneId(value: any): string | undefined { if (!value || typeof value !== "object") return undefined; for (const key of ["pane_id", "paneId"]) if (typeof value[key] === "string") return value[key]; for (const key of ["pane", "agent", "result"]) { const id = nestedPaneId(value[key]); if (id) return id; } return undefined; }

/** Real Herdr/Pi vertical slice. Never runs unless explicitly opted in. */
test.skipIf(!live)("G3 live single scout: native IDs, owned topology, and cleanup", async () => {
	expect(socketPath).toBeTruthy();
	const beforeLaunches = await names("launch-");
	const beforeLeases = await names("write-");
	const observer = new HerdrClient({ socketPath: socketPath! });
	let topology: TopologyResult | undefined;
	let ownedPaneIds: string[] = [];
	let during: unknown;
	try {
		const runtime = createHerdrSubagentRuntime({
			createTopology: async input => {
				topology = await createTopology(input);
				ownedPaneIds = [...topology.group.ownedPaneIds];
				// Layout apply may be unsupported/slow; observation is diagnostic only.
				during = await input.client.snapshot().catch(() => undefined);
				return topology;
			},
		});
		const result = await runtime.execute({ group: "g3-live-single", agent: "scout", task: "Do not use tools. Return exact text G3_OK only.", cwd: process.cwd(), timeoutSeconds: 120, keepOpen: false }, { cwd: process.cwd(), hasUI: false, ui: {} } as any);
		const details = result.details;
		const child = details.children[0];
		expect(details.status).toBe("succeeded"); expect(child.status).toBe("succeeded"); expect(child.finalOutput.trim()).toBe("G3_OK"); expect(topology).toBeDefined();
		if (during) { expect(tabIds(during).has(topology!.group.tabId)).toBe(true); expect(ownedPaneIds.every(id => paneIds(during).has(id))).toBe(true); }
		else console.info("G3 managed-tab/pane observation unavailable after layout request.");
		expect(ownedPaneIds).toHaveLength(1);
		const sessionPath = await realpath(child.piSession.path); expect(sessionPath).toBe(child.piSession.path);
		const entries = (await readFile(sessionPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
		expect(entries[0].id).toBe(child.piSession.sessionId); expect(entries.some(entry => entry.id === child.piSession.anchorEntryId)).toBe(true); expect(entries.some(entry => entry.id === child.piSession.finalEntryId)).toBe(true);
		console.info(`G3 layout warnings: ${JSON.stringify(details.warnings.filter((warning: string) => warning.includes("layout")))}`);
		const after = await observer.snapshot(); expect(tabIds(after).has(topology!.group.tabId)).toBe(false); expect(ownedPaneIds.every(id => !paneIds(after).has(id))).toBe(true); expect(await names("launch-")).toEqual(beforeLaunches); expect(await names("write-")).toEqual(beforeLeases);
	} finally { if (topology) { for (const paneId of ownedPaneIds) await observer.closePane(paneId).catch(() => undefined); await observer.closeTab(topology.group.tabId).catch(() => undefined); } observer.dispose(); }
}, 120_000);

/** Bounded operator opt-in: two read-only panes, then a two-step native-result chain. */
test.skipIf(!groupLive)("G13 live parallel and chain groups close by default", async () => {
	const beforeLaunches = await names("launch-"); const beforeLeases = await names("write-"); const observer = new HerdrClient({ socketPath: socketPath! });
	const topologies: TopologyResult[] = [];
	const runtime = createHerdrSubagentRuntime({ createTopology: async input => { const topology = await createTopology(input); topologies.push(topology); return topology; } }); const ctx = { cwd: process.cwd(), hasUI: false, ui: {} } as any;
	try {
		const parallel = await runtime.execute({ group: "g13-parallel", tasks: [{ name: "left", agent: "scout", task: "Do not use tools. Return exact text PARALLEL_LEFT only." }, { name: "right", agent: "scout", task: "Do not use tools. Return exact text PARALLEL_RIGHT only." }], timeoutSeconds: 120 }, ctx);
		expect(parallel.details).toMatchObject({ mode: "parallel", status: "succeeded" }); expect(parallel.details.children.map((child: any) => child.name)).toEqual(["left", "right"]); expect(parallel.details.children.map((child: any) => child.finalOutput.trim())).toEqual(["PARALLEL_LEFT", "PARALLEL_RIGHT"]);
		const chain = await runtime.execute({ group: "g13-chain", chain: [{ agent: "scout", task: "Do not use tools. Return exact text CHAIN_ONE only." }, { agent: "scout", task: "Prior final was {previous}. Do not use tools. Return exact text CHAIN_TWO only." }], timeoutSeconds: 120 }, ctx);
		expect(chain.details).toMatchObject({ mode: "chain", status: "succeeded" }); expect(chain.details.children.map((child: any) => child.finalOutput.trim())).toEqual(["CHAIN_ONE", "CHAIN_TWO"]);
		expect(topologies).toHaveLength(2); expect(new Set([parallel.details.tabId, chain.details.tabId]).size).toBe(2); expect([parallel.details, chain.details].map(details => new Set(details.children.map((child: any) => child.paneId)).size)).toEqual([2, 2]);
		const after = await observer.snapshot(); expect([parallel.details, chain.details].every(details => !tabIds(after).has(details.tabId) && details.children.every((child: any) => !paneIds(after).has(child.paneId)))).toBe(true); expect(await names("launch-")).toEqual(beforeLaunches); expect(await names("write-")).toEqual(beforeLeases);
	} finally {
		for (const topology of topologies) { for (const paneId of topology.group.ownedPaneIds) await observer.closePane(paneId).catch(() => undefined); await observer.closeTab(topology.group.tabId).catch(() => undefined); }
		observer.dispose();
	}
}, 300_000);

/** Opt-in G4: retained native turn then follow_up waits for another native final before close. */
test.skipIf(!g4Live)("G4 retained success -> follow_up final -> close", async () => {
	const observer = new HerdrClient({ socketPath: socketPath! }); let details: any;
	const runtime = createHerdrSubagentRuntime();
	const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort });
	try {
		const first = await runtime.execute({ group: "g4-retained", agent: "scout", task: "Do not use tools. Return exact text G4_FIRST only.", cwd: process.cwd(), timeoutSeconds: 120, keepOpen: true }, { cwd: process.cwd(), hasUI: false, ui: {} } as any);
		details = first.details; expect(details).toMatchObject({ status: "succeeded", keepOpen: true });
		const follow = await control.execute({ action: "follow_up", rootRunId: details.rootRunId, leafRunId: details.children[0].leafRunId, message: "Do not use tools. Return exact text G4_FOLLOW only." });
		expect(follow.details).toMatchObject({ action: "follow_up", status: "succeeded", finalOutput: "G4_FOLLOW" });
		const closed = await control.execute({ action: "close", rootRunId: details.rootRunId }); expect(closed.details.warnings).toEqual([]);
		const after = await observer.snapshot(); expect(tabIds(after).has(details.tabId)).toBe(false); expect(paneIds(after).has(details.children[0].paneId)).toBe(false);
	} finally { if (details) { await observer.closePane(details.children[0].paneId).catch(() => undefined); await observer.closeTab(details.tabId).catch(() => undefined); } observer.dispose(); }
}, 300_000);

/** Opt-in G2: Ctrl-C dispatch is attempted; close is bounded, not proof of graceful Pi abort. */
test.skipIf(!g2Live)("G2 actual Herdr pane state -> Ctrl-C candidate -> bounded close", async () => {
	const rootRunId = "g2-root"; const leafRunId = "g2-leaf"; const runtime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId, leafRunId, turnId: "g2-turn" }) });
	const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort }); const observer = new HerdrClient({ socketPath: socketPath! }); let details: any; let running: Promise<any> | undefined; let ownedPaneId: string | undefined; let ownedTabId: string | undefined;
	try {
		running = runtime.execute({ group: "g2-abort", agent: "scout", task: "Use Bash only to run `sleep 30`. Do not read, write, or change repository files. Do not respond until it exits.", cwd: process.cwd(), timeoutSeconds: 120, keepOpen: true }, { cwd: process.cwd(), hasUI: false, ui: {} } as any);
		const deadline = Date.now() + 30_000; let livePane = false;
		while (Date.now() < deadline && !livePane) {
			const leaf = runtime.registry.get(rootRunId)?.leaves.find(value => value.leafRunId === leafRunId); ownedPaneId = leaf?.paneId || ownedPaneId; ownedTabId = runtime.registry.get(rootRunId)?.tabId || ownedTabId;
			if (ownedPaneId) {
				const raw = await observer.getAgent(ownedPaneId).catch(() => undefined); const agent = raw?.agent ?? raw; const paneId = agent?.pane_id ?? agent?.paneId; const agentState = agent?.agent_status ?? agent?.state;
				livePane = paneId === ownedPaneId && (agentState === "working" || agentState === "booting");
			}
			if (!livePane) await new Promise(resolve => setTimeout(resolve, 100));
		}
		expect(livePane).toBe(true);
		const aborted = await control.execute({ action: "abort", rootRunId, leafRunId, timeoutSeconds: 1 }); expect(aborted.details).toMatchObject({ abortCandidateSent: true, gracefulAbortProven: false });
		await running.catch(() => undefined); expect(runtime.registry.get(rootRunId)).toBeUndefined();
		const after = await observer.snapshot(); expect(paneIds(after).has(ownedPaneId!)).toBe(false); expect(tabIds(after).has(ownedTabId!)).toBe(false);
	} finally { if (ownedPaneId) await observer.closePane(ownedPaneId).catch(() => undefined); if (ownedTabId) await observer.closeTab(ownedTabId).catch(() => undefined); observer.dispose(); await running?.catch(() => undefined); }
}, 180_000);

/** Opt-in G16: real writer leases across disposable repositories; never enables shared-write override. */
test.skipIf(!g16Live)("G16 live writers reject same cwd before side effect while different cwd succeeds", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-herdr-g16-")); let first: Promise<any> | undefined;
	try {
		const same = await disposableRepo(root, "same"); const other = await disposableRepo(root, "other");
		const before = await Promise.all([git(same, "branch", "--show-current"), git(same, "worktree", "list", "--porcelain"), git(other, "branch", "--show-current"), git(other, "worktree", "list", "--porcelain")]);
		const rootRunId = "g16-long-root"; const longRuntime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId, leafRunId: "g16-long-leaf", turnId: "g16-long-turn" }) }); const ctx = { cwd: same, hasUI: false, ui: {} } as any;
		first = longRuntime.execute({ group: "g16-long", agent: "worker", cwd: same, timeoutSeconds: 90, task: "Use write to create g16-long.txt with exact content G16_LONG. Use read to verify exact content. Use Bash only to run `test \"$(cat g16-long.txt)\" = G16_LONG`. Then use Bash only to run sleep 15; do not modify anything else. Return G16_LONG_DONE." }, ctx);
		const deadline = Date.now() + 30_000; while (!longRuntime.registry.get(rootRunId) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
		expect(longRuntime.registry.get(rootRunId)).toBeDefined();
		const rejected = createHerdrSubagentRuntime();
		await expect(rejected.execute({ group: "g16-reject", agent: "worker", cwd: same, timeoutSeconds: 60, task: "Use write to create g16-rejected.txt with exact content MUST_NOT_EXIST, then verify it." }, ctx)).rejects.toMatchObject({ code: "shared_workspace_write_conflict" });
		expect(await readFile(join(same, "g16-rejected.txt"), "utf8").catch(() => undefined)).toBeUndefined();
		const different = await createHerdrSubagentRuntime().execute({ group: "g16-other", agent: "worker", cwd: other, timeoutSeconds: 90, task: "Use write to create g16-other.txt with exact content G16_OTHER. Use read to verify exact content. Use Bash only to run `test \"$(cat g16-other.txt)\" = G16_OTHER`. Do not modify anything else. Return G16_OTHER_OK." }, { ...ctx, cwd: other });
		expect(different.details).toMatchObject({ status: "succeeded", children: [expect.objectContaining({ finalOutput: "G16_OTHER_OK" })] }); expect(await readFile(join(other, "g16-other.txt"), "utf8")).toBe("G16_OTHER");
		const long = await first; first = undefined; expect(long.details.status).toBe("succeeded"); expect(await readFile(join(same, "g16-long.txt"), "utf8")).toBe("G16_LONG");
		const after = await Promise.all([git(same, "branch", "--show-current"), git(same, "worktree", "list", "--porcelain"), git(other, "branch", "--show-current"), git(other, "worktree", "list", "--porcelain")]); expect(after).toEqual(before);
	} finally { await first?.catch(() => undefined); await rm(root, { recursive: true, force: true }); }
}, 300_000);

/** Opt-in G19: steering targets only an explicit active owned leaf and reaches its native final. */
test.skipIf(!g19Live)("G19 steer: explicit active leaf reaches native target then closes", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-herdr-g19-steer-")); const observer = new HerdrClient({ socketPath: socketPath! });
	const rootRunId = "g19-steer-root", leafRunId = "g19-steer-leaf"; const runtime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId, leafRunId, turnId: "g19-steer-turn" }) }); const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort });
	let details: any; let running: Promise<any> | undefined;
	try {
		running = runtime.execute({ group: "g19-steer", agent: "worker", cwd, keepOpen: true, timeoutSeconds: 90, task: "Use Bash only to run sleep 8. Do not modify files. Do not respond until it exits; then follow the steering message exactly." }, { cwd, hasUI: false, ui: {} } as any);
		await waitFor("G19 steer working leaf", () => runtime.registry.get(rootRunId)?.leaves[0]?.status === "working");
		const root = runtime.registry.get(rootRunId)!; const leaf = root.leaves[0]!;
		const steered = await control.execute({ action: "steer", rootRunId: root.rootRunId, leafRunId: leaf.leafRunId, message: "Return exact text G19_STEER_TARGET only." }); expect(steered.details.leaves).toEqual([expect.objectContaining({ leafRunId: leaf.leafRunId, paneId: leaf.paneId })]);
		const ref = await validatePiSessionRef((await observer.getAgent(leaf.paneId)).agent, sessionRoot);
		const failure = await running.catch(error => error); running = undefined; expect(failure).toMatchObject({ code: "ambiguous_turn" });
		const entries = (await readFile(ref.path, "utf8")).trim().split("\n").map(line => JSON.parse(line)); const target = entries.find(entry => entry.message?.role === "user" && entry.message?.content?.some((part: any) => part.text === "Return exact text G19_STEER_TARGET only."));
		expect(entries.find(entry => entry.message?.role === "assistant" && entry.parentId === target?.id)?.message?.content?.map((part: any) => part.text).join("")).toBe("G19_STEER_TARGET");
		await observer.closePane(leaf.paneId).catch(() => undefined); await observer.closeTab(root.tabId).catch(() => undefined);
	} finally { if (details) { await observer.closePane(details.children[0].paneId).catch(() => undefined); await observer.closeTab(details.tabId).catch(() => undefined); } observer.dispose(); await running?.catch(() => undefined); await rm(cwd, { recursive: true, force: true }); }
}, 180_000);

/** Opt-in G19: destructive Git reset block remains retained and collectable after fixed Enter. */
test.skipIf(!g19Live)("G19 blocked collect: fixed Enter resolves harmless permission prompt", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-herdr-g19-blocked-")); const cwd = await disposableRepo(root, "repo"); const observer = new HerdrClient({ socketPath: socketPath! });
	const gitState = async () => ({ head: await git(cwd, "rev-parse", "HEAD"), status: await git(cwd, "status", "--porcelain=v1"), tree: await git(cwd, "write-tree") });
	const runtime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId: "g19-blocked-root", leafRunId: "g19-blocked-leaf", turnId: "g19-blocked-turn" }) }); const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort }); let details: any;
	try {
		const before = await gitState();
		const launched = await runtime.execute({ group: "g19-blocked", agent: "worker", cwd, keepOpen: true, timeoutSeconds: 90, task: "Use Bash only to run git reset --hard HEAD. This is a disposable clean Git repository with a committed baseline. Do not write, create, or modify anything else. After the command, return exact text G19_BLOCKED_DONE only." }, { cwd, hasUI: false, ui: {} } as any);
		details = launched.details; const leaf = details.children[0];
		expect(await gitState()).toEqual(before);
		if (details.status !== "blocked") { console.info("G19 blocked/collect skipped: Pi integration auto-approved git reset --hard HEAD; no guardrail prompt was available (deterministic environment blocker)."); return; }
		expect(details).toMatchObject({ status: "blocked", keepOpen: true, children: [expect.objectContaining({ status: "blocked" })] });
		// Fixed internal Enter is the sole simulated human resolution; no caller-chosen key API is used.
		await observer.submitOwnedPane(leaf.paneId);
		let collected: any;
		await waitFor("G19 collected native final", async () => { const value = await control.execute({ action: "collect", rootRunId: details.rootRunId, leafRunId: leaf.leafRunId }).catch(() => undefined); if (value?.details?.finalOutput === "G19_BLOCKED_DONE") { collected = value; return true; } return false; }, 60_000);
		expect(collected.details).toMatchObject({ action: "collect", status: "succeeded", finalOutput: "G19_BLOCKED_DONE" }); expect(await gitState()).toEqual(before);
		const closed = await control.execute({ action: "close", rootRunId: details.rootRunId }); expect(closed.details.warnings).toEqual([]); expect(await gitState()).toEqual(before);
	} finally { const paneId = details?.children?.[0]?.paneId; if (paneId) await observer.closePane(paneId).catch(() => undefined); if (details?.tabId) await observer.closeTab(details.tabId).catch(() => undefined); observer.dispose(); await rm(root, { recursive: true, force: true }); }
}, 180_000);

/** Opt-in G19: losing an owned active pane produces explicit loss, never a fabricated final. */
test.skipIf(!g19Live)("G19 pane loss: active owned pane fails lost without output", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-herdr-g19-lost-")); const observer = new HerdrClient({ socketPath: socketPath! }); const rootRunId = "g19-lost-root"; const runtime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId, leafRunId: "g19-lost-leaf", turnId: "g19-lost-turn" }) }); let running: Promise<any> | undefined; let paneId: string | undefined; let tabId: string | undefined;
	try {
		running = runtime.execute({ group: "g19-lost", agent: "worker", cwd, keepOpen: true, timeoutSeconds: 90, task: "Use Bash only to run sleep 30. Do not modify files and do not respond until it exits." }, { cwd, hasUI: false, ui: {} } as any);
		await waitFor("G19 lost working leaf", () => { const root = runtime.registry.get(rootRunId); paneId = root?.leaves[0]?.paneId; tabId = root?.tabId; return root?.leaves[0]?.status === "working" && !!paneId; });
		await observer.closePane(paneId!); const result = await running; running = undefined;
		expect(result.details).toMatchObject({ status: "failed", children: [expect.objectContaining({ status: "lost", error: expect.objectContaining({ code: "pane_lost" }) })] }); expect(result.details.children[0].finalOutput).toBeUndefined();
	} finally { if (paneId) await observer.closePane(paneId).catch(() => undefined); if (tabId) await observer.closeTab(tabId).catch(() => undefined); observer.dispose(); await running?.catch(() => undefined); await rm(cwd, { recursive: true, force: true }); }
}, 180_000);

/** Opt-in G19: foreign typed topology setup survives owned-leaf cleanup. */
test.skipIf(!g19Live)("G19 foreign cleanup: owned close preserves foreign pane and tab", async () => {
	const observer = new HerdrClient({ socketPath: socketPath! }); const runtime = createHerdrSubagentRuntime({ ids: () => ({ rootRunId: "g19-foreign-root", leafRunId: "g19-foreign-leaf", turnId: "g19-foreign-turn" }) }); const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort }); let details: any; let foreignPaneId: string | undefined;
	try {
		const retained = await runtime.execute({ group: "g19-foreign", agent: "scout", cwd: process.cwd(), keepOpen: true, timeoutSeconds: 120, task: "Do not use tools. Return exact text G19_FOREIGN_READY only." }, { cwd: process.cwd(), hasUI: false, ui: {} } as any); details = retained.details; expect(details.status).toBe("succeeded");
		const started = await observer.startAgent({ name: "G19 test-owned foreign", argv: ["sh", "-c", "sleep 30"], cwd: process.cwd(), tabId: details.tabId, workspaceId: details.workspaceId, split: "right", focus: false }); foreignPaneId = nestedPaneId(started); expect(foreignPaneId).toBeTruthy();
		const closed = await control.execute({ action: "close", rootRunId: details.rootRunId, leafRunId: details.children[0].leafRunId }); expect(closed.details.warnings).toContain("WARNING: foreign pane present; tab left open.");
		const after = await observer.snapshot(); expect(tabIds(after).has(details.tabId)).toBe(true); expect(paneIds(after).has(foreignPaneId!)).toBe(true);
		await observer.closePane(foreignPaneId!); foreignPaneId = undefined; await observer.closeTab(details.tabId).catch(() => undefined); details = undefined;
	} finally { if (foreignPaneId) await observer.closePane(foreignPaneId).catch(() => undefined); if (details) { await observer.closePane(details.children[0].paneId).catch(() => undefined); await observer.closeTab(details.tabId).catch(() => undefined); } observer.dispose(); }
}, 180_000);

/** Opt-in G5: retained nested scouts, fourth-group capacity rejection, native evidence, and ownership-checked cleanup. */
test.skipIf(!g5Live)("G5 retained nested groups: labels, native finals, capacity rejection, and owned cleanup", async () => {
	const observer = new HerdrClient({ socketPath: socketPath! });
	const runtime = createHerdrSubagentRuntime();
	const control = createHerdrSubagentControlRuntime({ registry: runtime.registry, createClient: path => new HerdrClient({ socketPath: path }), preflight: checkPreconditions, sessionRoot, lifecyclePort: (client, paneId) => lifecyclePort(client as any, paneId), sessionPort });
	const ctx = { cwd: process.cwd(), hasUI: false, ui: {} } as any;
	const before = body(await observer.snapshot()); const beforeTabs = tabIds(before); const beforePanes = paneIds(before);
	const beforeLaunches = await names("launch-"); const beforeLeases = await names("write-");
	const capacity = new CapacityCoordinator({ snapshot: () => observer.snapshot() as any });
	let parent: any; let nested: any[] = []; let parentClosed = false;
	const cleanupNested = async () => {
		if (!nested.length) return;
		const snapshot = body(await observer.snapshot());
		for (const result of nested) {
			const tab = (snapshot.tabs ?? []).find((value: any) => (value.tab_id ?? value.id) === result.tabId);
			if (!tab) continue;
			const panes = (snapshot.panes ?? []).filter((value: any) => (value.tab_id ?? value.tabId) === result.tabId);
			if (tab.label !== result.tabLabel || panes.length !== result.children.length || panes.some((pane: any) => !result.children.some((child: any) => child.paneId === (pane.pane_id ?? pane.id)))) throw new Error("G5 nested ownership proof failed; refusing external cleanup.");
			for (const pane of panes) await observer.closePane(pane.pane_id ?? pane.id);
			await observer.closeTab(result.tabId).catch(() => undefined);
			await capacity.releaseGroup({ rootRunId: result.rootRunId, workspaceId: result.workspaceId });
		}
	};
	try {
		const started = await runtime.execute({ group: "g5-parent", agent: "orchestrator", cwd: process.cwd(), timeoutSeconds: 600, keepOpen: true,
			task: "Use subagent exactly twice, sequentially. Create retained single scout group g5-web with task: Do not use tools. Return exact text G5_WEB_NATIVE only. Then create retained single scout group g5-cli with task: Do not use tools. Return exact text G5_CLI_NATIVE only. Both must use keepOpen true. Leave both tabs open for parent observation. Return concise native-final handoff.",
		}, ctx);
		parent = started.details;
		expect(parent).toMatchObject({ group: "g5-parent", status: "succeeded", keepOpen: true, children: [{ agent: "orchestrator", status: "succeeded" }] });
		const entries = (await readFile(parent.children[0].piSession.path, "utf8")).trim().split("\n").map(line => JSON.parse(line));
		nested = entries.flatMap((entry: any) => entry.message?.role === "toolResult" && ["g5-web", "g5-cli"].includes(entry.message.details?.group) ? [entry.message.details] : []);
		expect(nested).toHaveLength(2);
		expect(nested).toEqual(expect.arrayContaining([expect.objectContaining({ group: "g5-web", parentRootRunId: parent.rootRunId, status: "succeeded", keepOpen: true, children: [expect.objectContaining({ finalOutput: "G5_WEB_NATIVE" })] }), expect.objectContaining({ group: "g5-cli", parentRootRunId: parent.rootRunId, status: "succeeded", keepOpen: true, children: [expect.objectContaining({ finalOutput: "G5_CLI_NATIVE" })] })]));

		const during = body(await observer.snapshot()); const createdTabs = (during.tabs ?? []).filter((tab: any) => !beforeTabs.has(tab.tab_id ?? tab.id));
		expect(createdTabs).toHaveLength(3); expect(createdTabs.map((tab: any) => tab.tab_id ?? tab.id)).toEqual(expect.arrayContaining([parent.tabId, ...nested.map(result => result.tabId)]));
		expect(createdTabs.map((tab: any) => tab.label)).toEqual(expect.arrayContaining([parent.tabLabel, ...nested.map(result => result.tabLabel)]));
		// Deliberate observation window; exactly parent, web, and cli remain retained.
		await new Promise(resolve => setTimeout(resolve, 10_000));
		await expect(runtime.execute({ group: "g5-overflow", agent: "scout", task: "Do not use tools. Return exact text G5_OVERFLOW_NATIVE only.", cwd: process.cwd(), keepOpen: true, timeoutSeconds: 60 }, ctx)).rejects.toMatchObject({ code: "tab_capacity_exceeded" });
		const afterReject = body(await observer.snapshot());
		expect((afterReject.tabs ?? []).filter((tab: any) => !beforeTabs.has(tab.tab_id ?? tab.id))).toHaveLength(3);

		await cleanupNested();
		expect((body(await observer.snapshot()).tabs ?? []).filter((tab: any) => !beforeTabs.has(tab.tab_id ?? tab.id))).toHaveLength(1);
		const closed = await control.execute({ action: "close", rootRunId: parent.rootRunId }); parentClosed = true;
		expect(closed.details.warnings).toEqual([]);
		const after = body(await observer.snapshot());
		expect([...tabIds(after)].filter(id => !beforeTabs.has(id))).toEqual([]); expect([...paneIds(after)].filter(id => !beforePanes.has(id))).toEqual([]);
		expect(await names("launch-")).toEqual(beforeLaunches); expect(await names("write-")).toEqual(beforeLeases);
	} finally {
		await cleanupNested().catch(() => undefined);
		if (parent && !parentClosed) await control.execute({ action: "close", rootRunId: parent.rootRunId }).catch(() => undefined);
		observer.dispose();
	}
}, 900_000);
