import { expect, test } from "bun:test";
import { runChainLifecycle, runLifecycleTurn, runParallelLifecycle, type AgentSnapshot, type HerdrLifecyclePort, type LifecycleResult, type SessionHarvestPort } from "./lifecycle.js";

function fake(states: AgentSnapshot[], options: { anchorAfter?: number; final?: boolean; materializeAfter?: number } = {}) {
	let now = 0, reads = 0, prepares = 0, materializes = 0, sends = 0, enters = 0, interrupts = 0, closes = 0;
	const clock = { now: () => now }; const sleeper = { sleep: async (ms: number) => { now += ms; } };
	const port: HerdrLifecyclePort = {
		getAgent: async () => { const value = states[Math.min(reads++, states.length - 1)]!; return value; },
		sendLiteral: async () => { sends++; }, sendEnter: async () => { enters++; },
		interruptOwnedPane: async () => { interrupts++; }, closeOwnedPane: async () => { closes++; },
	};
	const session = { sessionId: "s", path: "/s", root: "/", source: "herdr:pi" as const, kind: "path" as const, bytes: 1 };
	const anchor = { id: "a", parentId: null, marker: " [herdr:task-sentinel:v1:turn]" };
	const harvest: SessionHarvestPort = {
		prepare: async () => { prepares++; return { path: "/s", recordedAt: 0 }; },
		materialize: async () => ++materializes > (options.materializeAfter ?? 0) ? session : { pending: true },
		findAnchor: async () => sends >= (options.anchorAfter ?? 1) ? anchor : { pending: true },
		harvest: async () => options.final === false ? { pending: true } : ({ pending: false, status: "succeeded", output: "ok", stopReason: "stop", sessionId: "s", anchorEntryId: "a", finalEntryId: "f" }),
	};
	return { port, harvest, clock, sleeper, calls: () => ({ sends, enters, interrupts, closes, prepares, materializes }) };
}
const marker = " [herdr:task-sentinel:v1:turn]";
const turn = (f: ReturnType<typeof fake>, extra = {}) => runLifecycleTurn(f.port, f.harvest, { agentId: "a", task: `literal${marker}`, marker, turnId: "turn", clock: f.clock, sleeper: f.sleeper, timeoutMs: 20, pollIntervalMs: 2, ...extra });

test("boot unknown to idle is readiness, then sends one newline-free literal and exactly one Enter", async () => {
	const f = fake([{ state: "unknown", paneId: "p" }, { state: "idle", paneId: "p" }, { state: "idle", paneId: "p" }]);
	const result = await turn(f);
	expect(result).toMatchObject({ status: "succeeded", delivered: true, enterSent: true }); expect(f.calls()).toMatchObject({ sends: 1, enters: 1 });
	await expect(runLifecycleTurn(f.port, f.harvest, { agentId: "a", task: "bad\ntext", marker, turnId: "turn", clock: f.clock, sleeper: f.sleeper, timeoutMs: 1 })).rejects.toThrow("newline-free");
	await expect(runLifecycleTurn(f.port, f.harvest, { agentId: "a", task: "literal", marker, turnId: "turn", clock: f.clock, sleeper: f.sleeper, timeoutMs: 1 })).rejects.toThrow("terminal suffix");
});

test("onReady runs once after baseline preparation immediately before delivery", async () => {
	const f = fake([{ state: "idle", paneId: "p" }, { state: "done", paneId: "p" }]);
	const order: string[] = [];
	f.port.sendLiteral = async () => { order.push("literal"); };
	f.port.sendEnter = async () => { order.push("enter"); };
	f.harvest.prepare = async () => { order.push("prepare"); return { path: "/s", recordedAt: 0 }; };
	await turn(f, { onReady: async () => { order.push("ready"); } });
	expect(order).toEqual(["prepare", "ready", "literal", "enter"]);
});

test("missed working, done settlement, and delayed flush never resend", async () => {
	const f = fake([{ state: "idle", paneId: "p" }, { state: "done", paneId: "p" }, { state: "done", paneId: "p" }], { materializeAfter: 1 });
	expect((await turn(f)).status).toBe("succeeded"); expect(f.calls()).toMatchObject({ sends: 1, enters: 1, materializes: 2 });
});

test("startup idle is not completion; blocked returns promptly and pane loss is lost", async () => {
	const blocked = fake([{ state: "idle", paneId: "p" }, { state: "blocked", paneId: "p", blockedReason: "confirm" }]);
	expect(await turn(blocked)).toMatchObject({ status: "blocked", delivered: true }); expect(blocked.calls()).toMatchObject({ sends: 1, enters: 1 });
	const lost = fake([{ state: "idle", paneId: "p" }, { state: "working", paneId: "p", exists: false }]);
	expect(await turn(lost)).toMatchObject({ status: "lost" });
});

test("candidate done without correlated native final times out rather than fabricating success", async () => {
	const f = fake([{ state: "idle", paneId: "p" }, { state: "done", paneId: "p" }], { final: false });
	expect(await turn(f)).toMatchObject({ status: "timed_out" }); expect(f.calls()).toMatchObject({ sends: 1, enters: 1 });
});

test("cancellation sends one fixed interrupt candidate then owned close, never graceful-success claim", async () => {
	const f = fake([{ state: "idle", paneId: "p" }, { state: "working", paneId: "p" }]);
	const controller = new AbortController();
	const promise = turn(f, { signal: controller.signal, abortGraceMs: 2 }); controller.abort();
	expect(await promise).toMatchObject({ status: "aborted", abortCandidateSent: true }); expect(f.calls()).toMatchObject({ interrupts: 1, closes: 1 });
});

test("abort during get, literal send, or Enter returns structured aborted result", async () => {
	for (const phase of ["get", "send", "enter"] as const) {
		const f = fake([{ state: "idle", paneId: "p" }]); const controller = new AbortController();
		if (phase === "get") f.port.getAgent = async () => { controller.abort(); return await new Promise<never>(() => {}); };
		if (phase === "send") f.port.sendLiteral = async () => { controller.abort(); return await new Promise<never>(() => {}); };
		if (phase === "enter") f.port.sendEnter = async () => { controller.abort(); return await new Promise<never>(() => {}); };
		const result = await turn(f, { signal: controller.signal });
		expect(result).toMatchObject({ status: "aborted" });
		expect(result.delivered).toBe(phase === "enter"); expect(result.enterSent).toBe(false);
	}
});

test("retained done requires separate live Pi/session validation", async () => {
	const f = fake([{ state: "done", paneId: "p" }]);
	const retained = { sessionId: "s", path: "/s", root: "/", source: "herdr:pi" as const, kind: "path" as const, bytes: 1 };
	expect((await turn(f, { retainedDone: retained })).status).toBe("lost");
	f.port.validateRetainedDone = async () => true;
	expect((await turn(f, { retainedDone: retained })).status).toBe("succeeded");
	expect(f.calls().prepares).toBe(0);
});

test("pending prepare remains subject to boot timeout", async () => {
	const f = fake([{ state: "idle", paneId: "p" }]);
	f.harvest.prepare = async () => ({ pending: true });
	expect(await turn(f, { bootTimeoutMs: 4 })).toMatchObject({ status: "timed_out", delivered: false });
	expect(f.calls()).toMatchObject({ sends: 0, enters: 0 });
});

function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done; }), resolve }; }
const lifecycle = (status: LifecycleResult["status"], reason: string): LifecycleResult => ({ status, state: status === "blocked" ? "blocked" : "done", delivered: true, enterSent: true, reason });

test("parallel overlaps bounded starts and returns results in input order", async () => {
	const gates = [deferred<LifecycleResult>(), deferred<LifecycleResult>(), deferred<LifecycleResult>()];
	const starts: number[] = []; let active = 0, maximum = 0;
	const run = runParallelLifecycle(gates.map((gate, index) => ({ start: async () => { starts.push(index); maximum = Math.max(maximum, ++active); const result = await gate.promise; active--; return result; } })), 2);
	await Promise.resolve(); expect(starts).toEqual([0, 1]);
	gates[1]!.resolve(lifecycle("succeeded", "1")); await Promise.resolve(); await Promise.resolve();
	expect(starts).toEqual([0, 1, 2]);
	gates[0]!.resolve(lifecycle("succeeded", "0")); gates[2]!.resolve(lifecycle("succeeded", "2"));
	expect((await run).map(result => result.reason)).toEqual(["0", "1", "2"]); expect(maximum).toBe(2);
});

test("parallel block stops queued items but lets already-running work finish", async () => {
	const blocked = deferred<LifecycleResult>(), running = deferred<LifecycleResult>(); let starts = 0;
	const run = runParallelLifecycle([{ start: async () => { starts++; return blocked.promise; } }, { start: async () => { starts++; return running.promise; } }, { start: async () => { starts++; return lifecycle("succeeded", "queued"); } }], 2);
	await Promise.resolve(); expect(starts).toBe(2);
	blocked.resolve(lifecycle("blocked", "blocked")); running.resolve(lifecycle("succeeded", "running"));
	expect((await run).map(result => result.reason)).toEqual(["blocked", "running"]); expect(starts).toBe(2);
});

test("chain halts on any non-success", async () => {
	const chain = await runChainLifecycle([{ start: async () => ({ status: "failed", state: "done", delivered: true, enterSent: true } as const) }, { start: async () => { throw new Error("must not start"); } }]);
	expect(chain).toHaveLength(1);
});
