import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapacityCoordinator } from "./capacity.js";
import { DEFAULT_MAX_PAYLOAD_BYTES, paneSendTextRequestByteLength } from "./herdr-client.js";
import herdrExtension, { createHerdrSubagentRuntime, expandChainTask, formatSubagentPrompt, HerdrSetupError, lifecyclePort, sessionPort } from "./index.js";
import { ContractValidationError } from "./contracts.js";
import { PreconditionsError } from "./preconditions.js";
import { RunRegistry } from "./run-registry.js";

const context = { cwd: process.cwd(), hasUI: false, ui: {} } as any;
const ids = () => ({ rootRunId: "root", leafRunId: "leaf", turnId: "turn" });
const profile = (source: "user" | "project" = "user", tools: string[] = []) => ({ name: "scout", description: "desc", systemPrompt: "SECRET PROFILE BODY", source, filePath: "/profile.md", tools });
const preflight = async () => ({ socketPath: "/socket", workspaceId: "workspace", callerPaneId: "caller", nestingDepth: 0, protocol: 1, capabilities: {} as any, piExecutable: "/bin/pi" });

function vertical(options: { status?: any; keepOpen?: boolean; source?: "user" | "project"; tools?: string[]; capacity?: any; lifecycle?: (input: any) => Promise<any>; events?: string[]; registry?: RunRegistry; discover?: (cwd: string, scope: any) => any; env?: NodeJS.ProcessEnv; createLaunch?: (input: any) => Promise<any>; createTopology?: (input: any, topology: any) => any; addTopologyLeaf?: (input: any) => Promise<string>; cleanupTopology?: (input: any) => Promise<string[]>; restartAgent?: (client: any, paneId: string, leaf: any) => Promise<void> } = {}) {
	const events = options.events ?? [];
	const client = { dispose: () => events.push("dispose") } as any;
	const launch = { executable: "/bin/pi", name: "scout", argv: [], cwd: process.cwd(), env: {}, cleanupAfterReady: async () => { events.push("ready-cleanup"); }, cleanupAfterFailure: async () => { events.push("failure-cleanup"); } };
	const topology = { group: { tabId: "tab", tabLabel: "tab", ownedPaneIds: new Set(["pane"]), acceptedLeafIds: new Set() }, reservation: { paneCount: 4 }, leases: new Map(), warnings: [] } as any;
	let received: any; const receivedInputs: any[] = [];
	const runtime = createHerdrSubagentRuntime({
		preflight, ids, registry: options.registry,
		discover: (options.discover ?? (() => ({ agents: [profile(options.source, options.tools)], projectAgentsDir: options.source === "project" ? "/project/agents" : null }))) as any,
		env: options.env,
		createClient: () => client,
		createCapacity: () => options.capacity ?? ({ acquireWriteLease: async () => ({}) }),
		createLaunch: options.createLaunch ?? (async () => launch as any),
		createTopology: async (input: any) => options.createTopology ? options.createTopology(input, topology) : (topology.group.ownedPaneIds = new Set(input.leaves.map((_: any, index: number) => `pane-${index + 1}`)), topology),
		addTopologyLeaf: options.addTopologyLeaf ?? (async ({ result }: any) => { const pane = `pane-${result.group.ownedPaneIds.size + 1}`; result.group.ownedPaneIds.add(pane); return pane; }),
		cleanupTopology: options.cleanupTopology ?? (async ({ result }: any) => { events.push("topology-cleanup"); result.group.ownedPaneIds.clear(); return []; }),
		...(options.restartAgent ? { restartAgent: options.restartAgent } : {}),
		acceptLeaf: () => {},
		runLifecycle: (async (_port: any, _sessions: any, input: any) => {
			received = input; receivedInputs.push(input);
			if (options.lifecycle) return options.lifecycle(input);
			await input.onReady(); events.push("send");
			return { status: options.status ?? "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: options.status ?? "succeeded", output: "ok", stopReason: "stop", sessionId: "session", anchorEntryId: "anchor", finalEntryId: "final" }, session: { source: "herdr:pi", kind: "path", path: "/trusted/session.jsonl", root: "/", sessionId: "session", bytes: 1 } };
		}) as any,
	});
	return { runtime, events, get received() { return received; }, get receivedInputs() { return receivedInputs; } };
}

const params = (more = {}) => ({ group: "x", agent: "scout", task: "task", cwd: process.cwd(), ...more });

test("prompt and tool description prevent accidental same-cwd parallel writers", () => {
	const guidance = formatSubagentPrompt([
		{ ...profile("user", ["read", "edit"]), name: "worker", description: "Makes changes.", model: "openai-codex/terra", thinking: "medium" },
		{ ...profile("user", ["read", "bash"]), name: "scout", description: "Maps code.", thinking: "low" },
		{ name: "default", description: "Uses Pi defaults.", systemPrompt: "body", source: "user", filePath: "/default.md" },
	] as any);
	expect(guidance).toContain("worker [writer: edit/write/bash; model: openai-codex/terra; thinking: medium]");
	expect(guidance).toContain("scout [writer: edit/write/bash; model: inherit; thinking: low]");
	expect(guidance).toContain("default [writer: inherited caller tools (conservative); model: inherit; thinking: inherit]");
	expect(guidance).toContain("Profiles omitting `model`, `thinking`, or `tools` inherit the caller's effective value");
	expect(guidance).toContain("Profiles omitting `tools` are conservatively classified as writers");
	expect(guidance).toContain("Profiles declaring `edit`, `write`, or `bash` are also writers");
	expect(guidance).toContain("Omit `cwd` unless an exact existing path is known");
	expect(guidance).toContain("CR/LF input is normalized to spaces");
	expect(guidance).toContain("use `chain`");
	expect(formatSubagentPrompt([])).toContain("Parallel writers must use distinct existing canonical `cwd` values");

	const tools: any[] = [];
	herdrExtension({ on: () => {}, registerTool: (tool: any) => { tools.push(tool); } } as any);
	const description = tools.find(tool => tool.name === "subagent")?.description;
	expect(description).toContain("profiles omitting tools inherit the caller's active tools and are conservatively classified as writers");
	expect(description).toContain("profiles declaring edit/write/bash are also writers");
	expect(description).toContain("omitted cwd uses caller cwd");
	expect(description).toContain("CR/LF task input is normalized to spaces");
	expect(description).toContain("use chain for same-cwd writers");
	expect(formatSubagentPrompt([])).toContain("Retained follow-up");
	const control = tools.find(tool => tool.name === "subagent_control")?.description;
	expect(control).toContain("keepOpen root"); expect(control).toContain("idle/done"); expect(control).toContain("multiple eligible"); expect(control).toContain("native final"); expect(control).toContain("blocked"); expect(control).toContain("close");
});

test("passes the effective Pi runtime settings into every child launch", async () => {
	let launchInput: any;
	const fallbackLaunch = { executable: "/bin/pi", name: "default", argv: [], cwd: process.cwd(), env: {}, cleanupAfterReady: async () => {}, cleanupAfterFailure: async () => {} };
	const f = vertical({
		discover: (() => ({ agents: [{ name: "default", description: "inherits", systemPrompt: "body", source: "user", filePath: "/default.md" }], projectAgentsDir: null })) as any,
		createLaunch: async (input: any) => { launchInput = input; return fallbackLaunch; },
	});

	await f.runtime.execute({ group: "inherit", agent: "default", task: "work" }, {
		...context,
		model: { provider: "openai-codex", id: "gpt-test" },
		thinkingLevel: "high",
		activeTools: ["read", "bash"],
	});

	expect(launchInput.parentRuntime).toEqual({
		model: "openai-codex/gpt-test",
		thinking: "high",
		tools: ["read", "bash"],
	});
});

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

test("nested delegation allows only explicitly authorized read-only profiles before launch", async () => {
	const calls: string[] = [];
	const nestedEnv = { PI_HERDR_AGENT_PROFILE: "spec-writer", PI_HERDR_ALLOWED_CHILDREN: '["scout"]' } as NodeJS.ProcessEnv;
	const allowed = vertical({
		env: nestedEnv,
		discover: (() => ({ agents: [{ ...profile(), name: "scout", tools: ["read"] }], projectAgentsDir: null })) as any,
	});
	const result = await allowed.runtime.execute(params(), context);
	expect(result.details.status).toBe("succeeded");
	expect(allowed.events).toContain("send");

	for (const [label, env, target] of [
		["missing", { PI_HERDR_AGENT_PROFILE: "spec-writer" }, { ...profile(), name: "scout", tools: ["read"] }],
		["forbidden", { PI_HERDR_AGENT_PROFILE: "spec-writer", PI_HERDR_ALLOWED_CHILDREN: '["other"]' }, { ...profile(), name: "scout", tools: ["read"] }],
		["writer", nestedEnv, { ...profile(), name: "scout", tools: ["read", "bash"] }],
		["default-tools", nestedEnv, { ...profile(), name: "scout", tools: undefined }],
	] as const) {
		const runtime = createHerdrSubagentRuntime({
			preflight,
			env: env as NodeJS.ProcessEnv,
			discover: (() => ({ agents: [target], projectAgentsDir: null })) as any,
			createClient: () => { calls.push(`${label}:client`); return {} as any; },
			createCapacity: () => { calls.push(`${label}:capacity`); return {}; },
			createLaunch: async () => { calls.push(`${label}:launch`); throw new Error("must not launch"); },
		});
		await expect(runtime.execute(params(), context)).rejects.toMatchObject({ code: "nested_delegation_forbidden" });
	}
	expect(calls).toEqual([]);
});

test("nested delegation rejects a third read-only child before client allocation", async () => {
	const calls: string[] = [];
	const runtime = createHerdrSubagentRuntime({
		preflight,
		env: { PI_HERDR_AGENT_PROFILE: "plan-writer", PI_HERDR_ALLOWED_CHILDREN: '["scout"]' } as NodeJS.ProcessEnv,
		discover: (() => ({ agents: [{ ...profile(), name: "scout", tools: ["read"] }], projectAgentsDir: null })) as any,
		createClient: () => { calls.push("client"); return { dispose: () => {} } as any; },
		createLaunch: async () => { calls.push("launch"); throw new Error("must not launch"); },
	});
	await expect(runtime.execute({ group: "nested", tasks: [{ agent: "scout", task: "one" }, { agent: "scout", task: "two" }, { agent: "scout", task: "three" }] }, context)).rejects.toMatchObject({ code: "nested_delegation_forbidden" });
	expect(calls).toEqual([]);
});

test("single success delivers direct prompt with terminal sentinel, cleans prompt after ready, closes once, and returns trusted path", async () => {
	const f = vertical(); const updates: any[] = [];
	const result = await f.runtime.execute(params(), context, undefined, value => updates.push(value));
	expect(f.received).toMatchObject({ task: "task [herdr:task-sentinel:v1:turn]", marker: " [herdr:task-sentinel:v1:turn]", turnId: "turn" });
	expect(f.received.task).not.toContain("\n");
	expect(result.content[0].text).not.toContain("Control retained run:");
	expect(f.events).toEqual(["ready-cleanup", "send", "topology-cleanup", "dispose"]);
	expect(updates).toEqual([result]);
	expect(result.details.children[0].piSession.path).toBe("/trusted/session.jsonl");
	expect(JSON.stringify(result)).not.toContain("SECRET PROFILE BODY");
	expect(JSON.stringify(result)).not.toContain("\"task\"");
});

test("keepOpen retains terminal topology and blocked retains pane", async () => {
	const keep = vertical(); const kept = await keep.runtime.execute(params({ keepOpen: true }), context);
	expect(keep.events).toEqual(["ready-cleanup", "send", "dispose"]);
	expect(kept.content[0].text).toContain("Control retained run: root=root status=succeeded"); expect(kept.content[0].text).toContain("scout: leaf=leaf status=succeeded");
	expect(kept.content[0].text).not.toContain("pane-1"); expect(kept.content[0].text).not.toContain("/trusted/session.jsonl"); expect(kept.content[0].text).not.toContain("[herdr:");
	expect(keep.runtime.registry.get("root")?.status).toBe("succeeded"); expect(keep.runtime.registry.get("root")?.leaves[0]).toMatchObject({ activeTurnId: undefined, activeMarker: undefined });
	const timed = vertical({ status: "timed_out" }); const timedResult = await timed.runtime.execute(params({ keepOpen: true }), context);
	// A timed_out leaf may still be live, so it remains a compact control handle for reconciliation.
	expect(timedResult.content[0].text).toContain("Control retained run: root=root status=timed_out"); expect(timedResult.content[0].text).toContain("leaf=leaf status=timed_out"); expect(timedResult.content[0].text).toContain("reconcile its current pane"); expect(timed.runtime.registry.getLeaf("root", "leaf")).toMatchObject({ activeTurnId: "turn", activeMarker: " [herdr:task-sentinel:v1:turn]" });
	const timedDefault = vertical({ status: "timed_out" }); const timedDefaultResult = await timedDefault.runtime.execute(params(), context);
	expect(timedDefaultResult.content[0].text).toContain("Control retained run: root=root status=timed_out"); expect(timedDefault.events).toEqual(["ready-cleanup", "send", "dispose"]); expect(timedDefault.runtime.registry.get("root")?.leaves[0]?.status).toBe("timed_out");
	const blocked = vertical({ status: "blocked" }); const result = await blocked.runtime.execute(params(), context);
	expect(result.details.status).toBe("blocked"); expect(result.content[0].text).toContain("Control retained run: root=root status=blocked"); expect(result.content[0].text).toContain("leaf=leaf status=blocked"); expect(blocked.events).toEqual(["ready-cleanup", "send", "dispose"]);
	expect(blocked.runtime.registry.get("root")?.status).toBe("blocked"); expect(blocked.runtime.registry.get("root")?.leaves[0]).toMatchObject({ activeTurnId: "turn", activeMarker: " [herdr:task-sentinel:v1:turn]" });
});

test("failed owned-pane cleanup retains local authority for shutdown retry", async () => {
	const f = vertical({ cleanupTopology: async () => ["WARNING: failed to close owned pane pane-1."] });
	const result = await f.runtime.execute(params(), context);
	expect(result.details.warnings).toContain("WARNING: failed to close owned pane pane-1.");
	expect(f.runtime.registry.get("root")?.leaves[0]).toMatchObject({ paneId: "pane-1", status: "succeeded" });
});

test("retained controls omit never-launched queued chain leaves", async () => {
	const f = vertical({ status: "blocked" });
	const result = await f.runtime.execute({ group: "chain", chain: [{ name: "first", agent: "scout", task: "block" }, { name: "queued", agent: "scout", task: "later" }] }, context);
	expect(result.content[0].text).toContain("first: leaf=leaf status=blocked");
	expect(result.content[0].text).not.toContain("queued: leaf=");
	expect(result.details.children[1]).toMatchObject({ name: "queued", status: "queued", paneId: "" });
	expect(f.runtime.registry.get("root")?.leaves).toHaveLength(1);
});

test("shutdown returns immediately empty; releases only roots whose owned panes all close", async () => {
 let preflights = 0; const empty = createHerdrSubagentRuntime({ preflight: async () => { preflights++; return await preflight(); } }); await empty.shutdown(); expect(preflights).toBe(0);
 const registry = new RunRegistry(); const released: string[] = []; registry.register({ rootRunId: "good", workspaceId: "w", tabId: "tg", tabLabel: "g", status: "working", keepOpen: true, leaves: [{ leafRunId: "a", paneId: "a", status: "working" }, { leafRunId: "b", paneId: "b", status: "working" }, { leafRunId: "queued", paneId: "", status: "queued" }] }); registry.register({ rootRunId: "bad", workspaceId: "w", tabId: "tb", tabLabel: "b", status: "working", keepOpen: true, leaves: [{ leafRunId: "c", paneId: "c", status: "working" }] }); registry.setRelease("good", async () => { released.push("good"); }); registry.setRelease("bad", async () => { released.push("bad"); });
 const closed: string[] = []; const runtime = createHerdrSubagentRuntime({ registry, preflight, createClient: () => ({ closePane: async (id: string) => { closed.push(id); if (id === "c") throw new Error("no"); }, closeTab: async () => {}, dispose: () => {} }) as any }); await runtime.shutdown();
 expect(closed).toEqual(["a", "b", "c"]); expect(released).toEqual(["good"]); expect(registry.get("good")).toBeUndefined(); expect(registry.get("bad")).toBeDefined();
});

test("shutdown snapshots ownership before and at tab close, and leaves tabs on snapshot failure", async () => {
 const registry = new RunRegistry(); const released: string[] = []; for (const rootRunId of ["preexisting", "arriving", "unknown"]) { registry.register({ rootRunId, workspaceId: "w", tabId: rootRunId, tabLabel: rootRunId, status: "working", keepOpen: true, leaves: [{ leafRunId: rootRunId, paneId: `${rootRunId}-pane`, status: "working" }] }); registry.setRelease(rootRunId, async () => { released.push(rootRunId); }); }
 const closed: string[] = []; const tabs: string[] = []; let snapshots = 0;
 const runtime = createHerdrSubagentRuntime({ registry, preflight, createClient: () => ({ closePane: async (id: string) => { closed.push(id); }, closeTab: async (id: string) => { tabs.push(id); }, snapshot: async () => { if (++snapshots === 1) return { snapshot: { panes: [{ pane_id: "foreign", tab_id: "preexisting" }] } }; if (snapshots === 2) return { snapshot: { panes: [{ pane_id: "arriving-pane", tab_id: "arriving" }] } }; if (snapshots === 3) return { snapshot: { panes: [{ pane_id: "foreign", tab_id: "arriving" }] } }; throw new Error("snapshot unavailable"); }, dispose: () => {} }) as any });
 await runtime.shutdown();
 expect(closed).toEqual(["preexisting-pane", "arriving-pane", "unknown-pane"]); expect(tabs).toEqual([]); expect(released.sort()).toEqual(["arriving", "preexisting", "unknown"]); expect(registry.rootsSnapshot()).toEqual([]);
});

test("restarts one child that disappears before delivery, never after possible delivery", async () => {
	let attempts = 0; let restarts = 0;
	const retried = vertical({
		restartAgent: async () => { restarts++; },
		lifecycle: async input => {
			if (++attempts === 1) return { status: "lost", delivered: false, enterSent: false, state: "unknown", reason: "boot exit" };
			await input.onReady();
			return { status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: "ok", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } };
		},
	});
	const result = await retried.runtime.execute(params(), context);
	expect(restarts).toBe(1); expect(attempts).toBe(2); expect(retried.receivedInputs).toHaveLength(2);
	expect(result.details).toMatchObject({ status: "succeeded", children: [{ status: "succeeded", finalOutput: "ok" }] });

	let unsafeRestarts = 0;
	const uncertain = vertical({ restartAgent: async () => { unsafeRestarts++; }, lifecycle: async () => ({ status: "lost", delivered: true, enterSent: false, state: "unknown", reason: "delivery uncertain" }) });
	const uncertainResult = await uncertain.runtime.execute(params(), context);
	expect(unsafeRestarts).toBe(0);
	expect(uncertainResult.details).toMatchObject({ status: "failed", children: [{ status: "lost", error: { code: "pane_lost" } }] });
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

test("project confirmation rejects non-UI before client, capacity, or topology", async () => {
	const f = vertical({ source: "project" });
	await expect(f.runtime.execute(params(), context)).rejects.toMatchObject({ code: "project_agent_not_confirmed" });
	expect(f.events).toEqual([]);
});

test("project confirmation aggregates distinct selected local profiles and explicit false bypasses", async () => {
	const cwd = process.cwd(); let confirms = 0; let prompt = "";
	const discover = (itemCwd: string) => ({ agents: [{ ...profile("project"), name: itemCwd === cwd ? "first" : "second", filePath: itemCwd === cwd ? "/one/.pi/agents/first.md" : "/two/.pi/agents/second.md" }], projectAgentsDir: "/ignored" });
	const f = vertical({ discover });
	const uiContext = { ...context, hasUI: true, ui: { confirm: async (_title: string, body: string) => { confirms++; prompt = body; return true; } } };
	await f.runtime.execute({ group: "x", tasks: [{ agent: "first", task: "one" }, { agent: "second", task: "two", cwd: "/tmp" }] }, uiContext);
	expect(confirms).toBe(1); expect(prompt).toContain("first, second"); expect(prompt).toContain("/one/.pi/agents/first.md"); expect(prompt).toContain("/two/.pi/agents/second.md");
	const bypass = vertical({ source: "project" });
	await expect(bypass.runtime.execute(params({ confirmProjectAgents: false }), context)).resolves.toBeDefined();
});

test("canonical item cwd selects profiles from each project and Gondolin rejects differing cwd before client", async () => {
	const seen: string[] = []; const f = vertical({ discover: cwd => { seen.push(cwd); return { agents: [{ ...profile(), name: cwd === process.cwd() ? "first" : "second" }], projectAgentsDir: null }; } });
	await f.runtime.execute({ group: "x", tasks: [{ agent: "first", task: "one" }, { agent: "second", task: "two", cwd: "/tmp" }] }, context);
	expect(seen).toEqual([realpathSync(process.cwd()), realpathSync("/tmp")]);
	const gondolin = vertical({ env: { PI_SANDBOX: "gondolin" } as NodeJS.ProcessEnv });
	await expect(gondolin.runtime.execute({ group: "x", tasks: [{ agent: "scout", task: "one" }, { agent: "scout", task: "two", cwd: "/tmp" }] }, context)).rejects.toMatchObject({ code: "invalid_execution_mode" });
	expect(gondolin.events).toEqual([]);
	await expect(gondolin.runtime.execute({ group: "x", tasks: [{ agent: "scout", task: "one" }, { agent: "scout", task: "two", cwd: process.cwd() }] }, context)).resolves.toBeDefined();
});

test("parallel launches one tab's leaves concurrently in input order with independent sentinels", async () => {
	const f = vertical();
	const result = await f.runtime.execute({ group: "parallel", tasks: [{ name: "first", agent: "scout", task: "one" }, { name: "second", agent: "scout", task: "two" }] }, context);
	expect(result.details).toMatchObject({ mode: "parallel", status: "succeeded", children: [{ name: "first", paneId: "pane-1", status: "succeeded" }, { name: "second", paneId: "pane-2", status: "succeeded" }] });
	expect(f.receivedInputs.map(input => input.task.replace(input.marker, ""))).toEqual(["one", "two"]);
	expect(new Set(f.receivedInputs.map(input => input.marker)).size).toBe(2);
});

test("parallel blocked returns before deferred sibling and disposes client only after background settles", async () => {
	let releaseSibling!: () => void; const started: string[] = [];
	const f = vertical({ lifecycle: async input => {
		const task = input.task.replace(/ \[herdr:task-sentinel:v1:[^\]]+\]$/, ""); started.push(task); await input.onReady();
		if (task === "block") return { status: "blocked", delivered: true, enterSent: true, state: "blocked", reason: "need input" };
		return await new Promise(resolve => { releaseSibling = () => resolve({ status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: "later", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }); });
	} });
	const result = await f.runtime.execute({ group: "parallel", tasks: [{ name: "blocked", agent: "scout", task: "block" }, { name: "sibling", agent: "scout", task: "later" }] }, context);
	// The still-working sibling is not blocked or succeeded, so it is not advertised as a control handle yet (README: only successful keepOpen or blocked leaves are).
	expect(started).toEqual(["block", "later"]); expect(result.details.children.map((child: any) => child.status)).toEqual(["blocked", "working"]); expect(result.content[0].text).toContain("leaf=leaf status=blocked"); expect(result.content[0].text).not.toContain("sibling: leaf="); expect(f.events).not.toContain("dispose");
	releaseSibling();
	for (let turn = 0; turn < 20 && !f.events.includes("dispose"); turn++) await Promise.resolve();
	expect(f.runtime.registry.get("root")?.leaves.map(leaf => leaf.status)).toEqual(["blocked", "succeeded"]); expect(f.events).toContain("dispose");
});

test("parallel blocked background cleanup retains bound writer leases", async () => {
	let releaseSibling!: () => void; const releases: any[] = []; const capacity = { acquireWriteLease: async (input: any) => ({ cwd: input.cwd, rootRunId: input.rootRunId, acquired: true }), releaseWriteLease: async (lease: any) => { releases.push(lease); } };
	const f = vertical({ tools: ["edit"], capacity, createTopology: (input, topology) => { topology.group.ownedPaneIds = new Set(input.leaves.map((_: any, index: number) => `pane-${index + 1}`)); input.leaves.forEach((leaf: any) => topology.leases.set(leaf.leafRunId, leaf.lease)); return topology; }, lifecycle: async input => { await input.onReady(); const task = input.task.replace(/ \[herdr:task-sentinel:v1:[^\]]+\]$/, ""); if (task === "block") return { status: "blocked", delivered: true, enterSent: true, state: "blocked" }; return await new Promise(resolve => { releaseSibling = () => resolve({ status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: "done", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }); }); } });
	await f.runtime.execute({ group: "parallel", allowSharedWorkspaceWrites: true, tasks: [{ agent: "scout", task: "block" }, { agent: "scout", task: "later" }] }, context);
	releaseSibling(); await new Promise(resolve => setTimeout(resolve, 0));
	expect(releases).toEqual([]);
});

test("keepOpen keeps every pane open but releases write leases for non-succeeded leaves", async () => {
	const releases: any[] = [];
	const capacity = { acquireWriteLease: async (input: any) => ({ cwd: input.cwd, rootRunId: input.rootRunId, acquired: true }), releaseWriteLease: async (lease: any) => { releases.push(lease); } };
	const f = vertical({
		tools: ["edit"], capacity,
		createTopology: (input, topology) => { topology.group.ownedPaneIds = new Set(input.leaves.map((_: any, index: number) => `pane-${index + 1}`)); input.leaves.forEach((leaf: any) => topology.leases.set(leaf.leafRunId, leaf.lease)); return topology; },
		lifecycle: async input => {
			await input.onReady();
			const task = input.task.replace(/ \[herdr:task-sentinel:v1:[^\]]+\]$/, "");
			if (task === "fail") return { status: "failed", delivered: true, enterSent: true, state: "done", reason: "boom" };
			return { status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: "ok", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } };
		},
	});
	const result = await f.runtime.execute({ group: "parallel", allowSharedWorkspaceWrites: true, keepOpen: true, tasks: [{ name: "good", agent: "scout", task: "ok" }, { name: "bad", agent: "scout", task: "fail" }] }, context);
	expect(result.details.status).toBe("failed"); expect(result.details.children.map((c: any) => c.status)).toEqual(["succeeded", "failed"]);
	expect(f.events).not.toContain("topology-cleanup"); // both panes stay open under keepOpen, even the failed one
	expect(releases).toHaveLength(1); // only the failed leaf's write lease is released
	expect(result.content[0].text).toContain("good: leaf="); expect(result.content[0].text).not.toContain("bad: leaf="); // retainedControls lists only the succeeded leaf
});

test("chain registers every queued leaf before launch, then starts later pane after success", async () => {
	const seen: string[] = []; let count = 0; let queued: string[] | undefined; const registry = new RunRegistry();
	const f = vertical({ registry, lifecycle: async input => { seen.push(input.task.replace(/ \[herdr:task-sentinel:v1:[^\]]+\]$/, "")); queued ??= registry.get("root")?.leaves.map(leaf => leaf.status); await input.onReady(); count++; return { status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: count === 1 ? "prior" : "ok", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }; } });
	const result = await f.runtime.execute({ group: "chain", chain: [{ agent: "scout", task: "first" }, { agent: "scout", task: "{previous}:{previous}" }] }, context);
	expect(queued).toEqual(["booting", "queued"]); expect(seen).toEqual(["first", "\"prior\":\"prior\""]); expect(result.details.children.map((x: any) => x.status)).toEqual(["succeeded", "succeeded"]);
});

test("chain previous JSON expansion is one-line, reversible, and payload-validated before next delivery", async () => {
	const prior = "line one\r\nline two \\ \" quote 😀";
	const expanded = expandChainTask("prior={previous}", prior);
	expect(expanded).not.toMatch(/[\r\n]/); expect(JSON.parse(expanded.slice("prior=".length))).toBe(prior);
	const seen: string[] = []; let calls = 0;
	const f = vertical({ lifecycle: async input => { seen.push(input.task.replace(/ \[herdr:task-sentinel:v1:[^\]]+\]$/, "")); await input.onReady(); calls++; return { status: "succeeded", delivered: true, enterSent: true, state: "done", result: { pending: false, status: "succeeded", output: calls === 1 ? "\n\\".repeat(DEFAULT_MAX_PAYLOAD_BYTES) : "unexpected", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }, session: { source: "herdr:pi", kind: "path", path: "/s", root: "/", bytes: 1 } }; } });
	await expect(f.runtime.execute({ group: "chain", chain: [{ agent: "scout", task: "first" }, { agent: "scout", task: "{previous}" }] }, context)).rejects.toMatchObject({ code: "task_delivery_failed" });
	expect(seen).toEqual(["first"]);
});

test("chain writer acquires only initial and later-start lease", async () => {
	const acquired: any[] = []; const capacity = { acquireWriteLease: async (input: any) => { acquired.push(input); return { cwd: input.cwd, rootRunId: input.rootRunId, acquired: true }; }, releaseWriteLease: async () => {}, releaseGroup: async () => {} };
	const f = vertical({ tools: ["edit"], capacity });
	await f.runtime.execute({ group: "chain", chain: [{ agent: "scout", task: "first" }, { agent: "scout", task: "second" }] }, context);
	expect(acquired).toHaveLength(2); expect(acquired.map(value => value.cwd)).toEqual([process.cwd(), process.cwd()]);
});

test("oversize escaped pane.send_text request fails before lifecycle delivery", async () => {
	const marker = " [herdr:task-sentinel:v1:turn]";
	const overhead = paneSendTextRequestByteLength("pane-1", marker);
	const task = "\\".repeat(Math.floor((DEFAULT_MAX_PAYLOAD_BYTES - overhead) / 2) + 1);
	const f = vertical();
	await expect(f.runtime.execute(params({ task }), context)).rejects.toMatchObject({ code: "task_delivery_failed" });
	expect(f.receivedInputs).toEqual([]); expect(f.runtime.registry.get("root")).toBeUndefined();
});

test("later chain add failure releases provisional writer lease for immediate other-coordinator acquisition", async () => {
	const runtimeRoot = await mkdtemp(join(tmpdir(), "pi-herdr-chain-lease-"));
	try {
		const snapshot = async () => ({}); const first = new CapacityCoordinator({ runtimeRoot, snapshot }); const other = new CapacityCoordinator({ runtimeRoot, snapshot });
		const discover = (_cwd: string) => ({ agents: [{ ...profile(), name: "reader", tools: [] }, { ...profile(), name: "writer", tools: ["edit"] }], projectAgentsDir: null });
		const f = vertical({ discover, capacity: first, addTopologyLeaf: async () => { throw new Error("add failed"); } });
		await expect(f.runtime.execute({ group: "chain", chain: [{ agent: "reader", task: "first" }, { agent: "writer", task: "second" }] }, context)).rejects.toMatchObject({ code: "agent_start_failed" });
		await expect(other.acquireWriteLease({ cwd: process.cwd(), rootRunId: "other", tools: ["write"] })).resolves.toMatchObject({ acquired: true });
	} finally { await rm(runtimeRoot, { recursive: true, force: true }); }
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

test("session adapter polls transiently missing Herdr reference but rejects a reported invalid reference", async () => {
	const sessions = sessionPort("/sessions");
	const agent = { state: "idle", paneId: "pane", agentInfo: { agent: "pi", agent_status: "idle" } } as any;
	expect(await sessions.prepare(agent)).toEqual({ pending: true });
	agent.agentInfo.agent_session = { source: "other", kind: "path", value: "/sessions/child.jsonl" };
	await expect(sessions.prepare(agent)).rejects.toThrow("session_reference_missing");
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
