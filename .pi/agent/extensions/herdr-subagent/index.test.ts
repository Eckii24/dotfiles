import { expect, test } from "bun:test";
import { createHerdrSubagentRuntime, HerdrSetupError, lifecyclePort } from "./index.js";
import { ContractValidationError } from "./contracts.js";
import { PreconditionsError } from "./preconditions.js";
import { RunRegistry } from "./run-registry.js";

const context = { cwd: process.cwd(), hasUI: false, ui: {} } as any;
const ids = () => ({ rootRunId: "root", leafRunId: "leaf", turnId: "turn" });
const profile = (source: "user" | "project" = "user", tools: string[] = []) => ({ name: "scout", description: "desc", systemPrompt: "SECRET PROFILE BODY", source, filePath: "/profile.md", tools });
const preflight = async () => ({ socketPath: "/socket", workspaceId: "workspace", callerPaneId: "caller", nestingDepth: 0, protocol: 1, capabilities: {} as any, piExecutable: "/bin/pi" });

function vertical(options: { status?: any; keepOpen?: boolean; source?: "user" | "project"; tools?: string[]; capacity?: any; lifecycle?: (input: any) => Promise<any>; events?: string[]; registry?: RunRegistry } = {}) {
	const events = options.events ?? [];
	const client = { dispose: () => events.push("dispose") } as any;
	const launch = { executable: "/bin/pi", name: "scout", argv: [], cwd: process.cwd(), env: {}, cleanupAfterReady: async () => { events.push("ready-cleanup"); }, cleanupAfterFailure: async () => { events.push("failure-cleanup"); } };
	const topology = { group: { tabId: "tab", tabLabel: "tab", ownedPaneIds: new Set(["pane"]), acceptedLeafIds: new Set() }, reservation: { paneCount: 4 }, leases: new Map(), warnings: [] } as any;
	let received: any;
	const runtime = createHerdrSubagentRuntime({
		preflight, ids, registry: options.registry,
		discover: (() => ({ agents: [profile(options.source, options.tools)], projectAgentsDir: options.source === "project" ? "/project/agents" : null })) as any,
		createClient: () => client,
		createCapacity: () => options.capacity ?? ({ acquireWriteLease: async () => ({}) }),
		createLaunch: async () => launch as any,
		createTopology: async (input: any) => { topology.group.ownedPaneIds = new Set(input.leaves.map((_: any, index: number) => `pane-${index + 1}`)); return topology; },
		addTopologyLeaf: async ({ result, leaf }: any) => { const pane = `pane-${result.group.ownedPaneIds.size + 1}`; result.group.ownedPaneIds.add(pane); return pane; },
		cleanupTopology: async () => { events.push("topology-cleanup"); return []; },
		acceptLeaf: () => {},
		runLifecycle: (async (_port: any, _sessions: any, input: any) => {
			received = input;
			if (options.lifecycle) return options.lifecycle(input);
			await input.onReady(); events.push("send");
			return { status: options.status ?? "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: options.status ?? "succeeded", output: "ok", stopReason: "stop", sessionId: "session", anchorEntryId: "anchor", finalEntryId: "final" }, session: { source: "herdr:pi", kind: "path", path: "/trusted/session.jsonl", root: "/", sessionId: "session", bytes: 1 } };
		}) as any,
	});
	return { runtime, events, get received() { return received; } };
}

const params = (more = {}) => ({ group: "x", agent: "scout", task: "task", cwd: process.cwd(), ...more });

test("validation and unsupported mode throw before Herdr preflight side effects", async () => {
	let calls = 0;
	const runtime = createHerdrSubagentRuntime({ preflight: async () => { calls++; throw new Error("must not run"); } });
	await expect(runtime.execute({ group: "" }, context)).rejects.toBeInstanceOf(ContractValidationError);
	await expect(runtime.execute({ group: "x", tasks: [{ agent: "scout", task: "x" }] }, context)).rejects.toMatchObject({ code: "agent_start_failed" });
	expect(calls).toBe(1);
});

test("valid input runs preflight before discovery, client, capacity, launch, or topology", async () => {
	const calls: string[] = [];
	const runtime = createHerdrSubagentRuntime({ preflight: async () => { calls.push("preflight"); throw new PreconditionsError("not_in_herdr", "no"); }, discover: (() => { calls.push("discover"); return { agents: [], projectAgentsDir: null }; }) as any, createClient: () => { calls.push("client"); return {} as any; }, createCapacity: () => { calls.push("capacity"); return {}; }, createLaunch: async () => { calls.push("launch"); throw new Error("no"); }, createTopology: (async () => { calls.push("topology"); throw new Error("no"); }) as any });
	await expect(runtime.execute(params(), context)).rejects.toMatchObject({ code: "not_in_herdr" });
	expect(calls).toEqual(["preflight"]);
});

test("maximum nesting rejects before discovery or launch side effects", async () => {
	const calls: string[] = [];
	const runtime = createHerdrSubagentRuntime({
		preflight: async () => { calls.push("preflight"); return { ...(await preflight()), nestingDepth: 3 }; },
		discover: (() => { calls.push("discover"); return { agents: [], projectAgentsDir: null }; }) as any,
		createClient: () => { calls.push("client"); return {} as any; },
	});
	await expect(runtime.execute(params(), context)).rejects.toMatchObject({ code: "nesting_depth_exceeded" });
	expect(calls).toEqual(["preflight"]);
});

test("single success delivers newline-free envelope, cleans prompt after ready, closes once, and returns trusted path", async () => {
	const f = vertical(); const updates: any[] = [];
	const result = await f.runtime.execute(params(), context, undefined, value => updates.push(value));
	expect(f.received.task).not.toContain("\n");
	expect(JSON.parse(f.received.task)).toMatchObject({ type: "herdr_subagent_task", rootRunId: "root", leafRunId: "leaf", turnId: "turn", task: "task" });
	expect(f.events).toEqual(["ready-cleanup", "send", "topology-cleanup", "dispose"]);
	expect(updates).toEqual([result]);
	expect(result.details.children[0].piSession.path).toBe("/trusted/session.jsonl");
	expect(JSON.stringify(result)).not.toContain("SECRET PROFILE BODY");
	expect(JSON.stringify(result)).not.toContain("\"task\"");
});

test("keepOpen retains terminal topology and blocked retains pane", async () => {
	const keep = vertical(); await keep.runtime.execute(params({ keepOpen: true }), context);
	expect(keep.events).toEqual(["ready-cleanup", "send", "dispose"]);
	expect(keep.runtime.registry.get("root")?.status).toBe("succeeded"); expect(keep.runtime.registry.get("root")?.leaves[0]).toMatchObject({ activeTurnId: undefined, activeMarker: undefined });
	const blocked = vertical({ status: "blocked" }); const result = await blocked.runtime.execute(params(), context);
	expect(result.details.status).toBe("blocked"); expect(blocked.events).toEqual(["ready-cleanup", "send", "dispose"]);
	expect(blocked.runtime.registry.get("root")?.status).toBe("blocked"); expect(blocked.runtime.registry.get("root")?.leaves[0]).toMatchObject({ activeTurnId: "turn" });
});

test("launched lifecycle failure and abort return structured terminal results and clean up", async () => {
	const failed = vertical({ lifecycle: async input => { await input.onReady(); return { status: "failed", delivered: true, state: "done", reason: "bad" }; } });
	const failedResult = await failed.runtime.execute(params(), context);
	expect(failedResult.details).toMatchObject({ status: "failed", children: [{ status: "failed", error: { code: "result_unavailable" } }] });
	expect(failed.events).toEqual(["ready-cleanup", "topology-cleanup", "dispose"]);
	const aborted = vertical({ lifecycle: async input => ({ status: input.signal?.aborted ? "aborted" : "failed", delivered: false, state: "working", reason: "abort" }) });
	const controller = new AbortController(); controller.abort();
	const abortResult = await aborted.runtime.execute(params(), context, controller.signal);
	expect(abortResult.details).toMatchObject({ status: "aborted", children: [{ status: "aborted", error: { code: "child_aborted" } }] });
	expect(aborted.events).toEqual(["failure-cleanup", "topology-cleanup", "dispose"]);
});

test("project confirmation decline names requested profiles without launch", async () => {
	const f = vertical({ source: "project" }); let prompt: string | undefined;
	const projectContext = { ...context, hasUI: true, ui: { confirm: async (_title: string, body: string) => { prompt = body; return false; } } };
	await expect(f.runtime.execute(params(), projectContext)).rejects.toMatchObject({ code: "project_agent_not_confirmed" });
	expect(prompt).toContain("Agents: scout"); expect(prompt).not.toContain("[object Object]"); expect(f.events).toEqual([]);
});

test("parallel launches one tab's leaves concurrently in input order", async () => {
	const f = vertical();
	const result = await f.runtime.execute({ group: "parallel", tasks: [{ name: "first", agent: "scout", task: "one" }, { name: "second", agent: "scout", task: "two" }] }, context);
	expect(result.details).toMatchObject({ mode: "parallel", status: "succeeded", children: [{ name: "first", paneId: "pane-1", status: "succeeded" }, { name: "second", paneId: "pane-2", status: "succeeded" }] });
});

test("parallel blocked returns before deferred sibling and disposes client only after background settles", async () => {
	let releaseSibling!: () => void; const started: string[] = [];
	const f = vertical({ lifecycle: async input => {
		const task = JSON.parse(input.task).task; started.push(task); await input.onReady();
		if (task === "block") return { status: "blocked", delivered: true, enterSent: true, state: "blocked", reason: "need input" };
		return await new Promise(resolve => { releaseSibling = () => resolve({ status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: "later", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }); });
	} });
	const result = await f.runtime.execute({ group: "parallel", tasks: [{ name: "blocked", agent: "scout", task: "block" }, { name: "sibling", agent: "scout", task: "later" }] }, context);
	expect(started).toEqual(["block", "later"]); expect(result.details.children.map((child: any) => child.status)).toEqual(["blocked", "working"]); expect(f.events).not.toContain("dispose");
	releaseSibling();
	for (let turn = 0; turn < 20 && !f.events.includes("dispose"); turn++) await Promise.resolve();
	expect(f.runtime.registry.get("root")?.leaves.map(leaf => leaf.status)).toEqual(["blocked", "succeeded"]); expect(f.events).toContain("dispose");
});

test("chain registers every queued leaf before launch, then starts later pane after success", async () => {
	const seen: string[] = []; let count = 0; let queued: string[] | undefined; const registry = new RunRegistry();
	const f = vertical({ registry, lifecycle: async input => { seen.push(JSON.parse(input.task).task); queued ??= registry.get("root")?.leaves.map(leaf => leaf.status); await input.onReady(); count++; return { status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: count === 1 ? "prior" : "ok", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }; } });
	const result = await f.runtime.execute({ group: "chain", chain: [{ agent: "scout", task: "first" }, { agent: "scout", task: "{previous}:{previous}" }] }, context);
	expect(queued).toEqual(["booting", "queued"]); expect(seen).toEqual(["first", "prior:prior"]); expect(result.details.children.map((x: any) => x.status)).toEqual(["succeeded", "succeeded"]);
});

test("chain declared writer reacquires its cwd lease only when later pane starts", async () => {
	const acquired: any[] = []; const capacity = { acquireWriteLease: async (input: any) => { acquired.push(input); return { cwd: input.cwd, rootRunId: input.rootRunId, acquired: true }; }, releaseWriteLease: async () => {}, releaseGroup: async () => {} };
	const f = vertical({ tools: ["edit"], capacity });
	await f.runtime.execute({ group: "chain", chain: [{ agent: "scout", task: "first" }, { agent: "scout", task: "second" }] }, context);
	expect(acquired).toHaveLength(3); expect(acquired.map(value => value.cwd)).toEqual([process.cwd(), process.cwd(), process.cwd()]);
});

test("parallel explicit shared-write override returns a warning", async () => {
	let count = 0; const capacity = { acquireWriteLease: async (input: any) => (++count === 1 ? { cwd: input.cwd, rootRunId: input.rootRunId, acquired: true } : { cwd: input.cwd, rootRunId: input.rootRunId, acquired: false, warning: "WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict." }), releaseWriteLease: async () => {}, releaseGroup: async () => {} };
	const f = vertical({ tools: ["edit"], capacity });
	const result = await f.runtime.execute({ group: "parallel", allowSharedWorkspaceWrites: true, tasks: [{ name: "one", agent: "scout", task: "one" }, { name: "two", agent: "scout", task: "two" }] }, context);
	expect(result.details.warnings).toContain("WARNING: shared workspace writes explicitly allowed; concurrent writers may conflict.");
});

test("adapter prefers Herdr agent_status over legacy state/status", async () => {
	const port = lifecyclePort({ getAgent: async () => ({ agent_status: "idle", state: "working", pane_id: "pane" }) } as any, "pane");
	expect((await port.getAgent("pane"))?.state).toBe("idle");
});

test("topology, profile, and preflight setup failures are typed and registry closes only cleaned runs", async () => {
	const events: string[] = [];
	const broken = createHerdrSubagentRuntime({ preflight, ids, discover: (() => ({ agents: [profile()], projectAgentsDir: null })) as any, createClient: () => ({ dispose: () => events.push("dispose") } as any), createCapacity: () => ({ acquireWriteLease: async () => ({}) }), createLaunch: async () => ({ executable: "/bin/pi", name: "scout", argv: [], cwd: process.cwd(), env: {}, cleanupAfterReady: async () => {}, cleanupAfterFailure: async () => { events.push("failure-cleanup"); } } as any), createTopology: (async () => { throw new Error("start failed"); }) as any });
	await expect(broken.execute(params(), context)).rejects.toMatchObject({ code: "agent_start_failed" });
	expect(events).toEqual(["failure-cleanup", "dispose"]);

	const noProfile = createHerdrSubagentRuntime({ preflight, discover: (() => ({ agents: [], projectAgentsDir: null })) as any });
	await expect(noProfile.execute(params(), context)).rejects.toBeInstanceOf(HerdrSetupError);
	const preflightFailure = createHerdrSubagentRuntime({ preflight: async () => { throw new PreconditionsError("not_in_herdr", "no"); } });
	await expect(preflightFailure.execute(params(), context)).rejects.toMatchObject({ code: "not_in_herdr" });
	const registry = new RunRegistry(); const f = vertical({ registry }); await f.runtime.execute(params(), context);
	expect(registry.get("root")).toBeUndefined();
});
