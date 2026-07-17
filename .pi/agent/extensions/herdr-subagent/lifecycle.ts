import type { Clock, Pending, SessionBaseline, TrustedMaterializedSession, TurnAnchor, HarvestResult } from "./pi-session.js";

/** Herdr lifecycle states are evidence about a live Pi process, never result evidence. */
export type AgentState = "unknown" | "idle" | "working" | "blocked" | "done";
export type AgentSnapshot = { state: AgentState; paneId: string; exists?: boolean; agentInfo?: unknown; blockedReason?: string };
export type Sleeper = { sleep(ms: number): Promise<void> };

/** Narrow, socket-free boundary. Implementations must target only the owned agent/pane. */
export type HerdrLifecyclePort = {
	getAgent(agentId: string, signal?: AbortSignal): Promise<AgentSnapshot | undefined>;
	sendLiteral(agentId: string, text: string, signal?: AbortSignal): Promise<void>;
	sendEnter(agentId: string, signal?: AbortSignal): Promise<void>;
	waitForEvent?(agentId: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
	interruptOwnedPane?(paneId: string, signal?: AbortSignal): Promise<void>;
	closeOwnedPane?(paneId: string, signal?: AbortSignal): Promise<void>;
	/** Required before a retained done pane accepts a follow-up turn. */
	validateRetainedDone?(agentId: string, session: TrustedMaterializedSession, signal?: AbortSignal): Promise<boolean>;
};

/** Adapter boundary for pi-session.ts. It deliberately carries trusted Pi-session types, not socket frames. */
export type SessionHarvestPort = {
	prepare(agent: AgentSnapshot, signal?: AbortSignal): Promise<SessionBaseline | Pending>;
	materialize(baseline: SessionBaseline, signal?: AbortSignal): Promise<TrustedMaterializedSession | Pending>;
	findAnchor(session: TrustedMaterializedSession, turnId: string, signal?: AbortSignal): Promise<TurnAnchor | Pending>;
	harvest(session: TrustedMaterializedSession, turnId: string, anchor: TurnAnchor, lifecycle: { state: AgentState }, signal?: AbortSignal): Promise<HarvestResult | Pending>;
};

export type LifecycleResult = {
	status: "succeeded" | "failed" | "aborted" | "blocked" | "timed_out" | "lost";
	state: AgentState;
	delivered: boolean;
	enterSent: boolean;
	result?: HarvestResult;
	/** Trusted session that produced result; callers must use this path verbatim. */
	session?: TrustedMaterializedSession;
	reason?: string;
	abortCandidateSent?: boolean;
};
export type LifecycleOptions = {
	agentId: string;
	task: string;
	turnId: string;
	clock: Clock;
	sleeper: Sleeper;
	timeoutMs: number;
	bootTimeoutMs?: number;
	pollIntervalMs?: number;
	abortGraceMs?: number;
	signal?: AbortSignal;
	/** A done pane is accepted only after this separate validation port proves it remains Pi/session-identical. */
	retainedDone?: TrustedMaterializedSession;
	/** Runs once after readiness and baseline/trusted-session preparation, directly before delivery. */
	onReady?: () => Promise<void> | void;
};

export class LifecycleError extends Error { constructor(message: string) { super(message); this.name = "LifecycleError"; } }
const pending = (value: unknown): value is Pending => typeof value === "object" && value !== null && (value as { pending?: unknown }).pending === true;

/**
 * One-turn state machine. Delivery happens in precisely one adjacent literal/Enter pair.
 * Idle is readiness before delivery; after a native anchor it is only a harvest candidate.
 */
export async function runLifecycleTurn(port: HerdrLifecyclePort, sessions: SessionHarvestPort, input: LifecycleOptions): Promise<LifecycleResult> {
	if (!input.task || /[\r\n]/.test(input.task)) throw new LifecycleError("Task literal must be non-empty and newline-free.");
	if (!input.turnId) throw new LifecycleError("turnId is required.");
	const poll = input.pollIntervalMs ?? 250;
	const deadline = input.clock.now() + input.timeoutMs;
	const bootDeadline = input.clock.now() + (input.bootTimeoutMs ?? input.timeoutMs);
	let delivered = false, enterSent = false, state: AgentState = "unknown";
	let baseline: SessionBaseline | undefined;
	let session: TrustedMaterializedSession | undefined;
	let anchor: TurnAnchor | undefined;
	let abortCandidateSent = false;
	let readyNotified = false;

	if (input.retainedDone) {
		if (!port.validateRetainedDone || !(await port.validateRetainedDone(input.agentId, input.retainedDone, input.signal))) {
			return { status: "lost", state, delivered, enterSent, reason: "Retained done pane no longer proves live Pi/session identity." };
		}
		session = input.retainedDone;
	}

	for (;;) {
		if (input.signal?.aborted) return abort(port, input, state, delivered, enterSent, abortCandidateSent);
		const snapshot = await abortable(port.getAgent(input.agentId, input.signal), input.signal);
		if (snapshot === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent);
		if (!snapshot || snapshot.exists === false) return { status: "lost", state, delivered, enterSent, reason: "Owned pane or agent disappeared." };
		state = snapshot.state;
		if (state === "blocked") {
			// Preserve trusted session identity for retained collect after fixed human resolution.
			if (delivered && !session && baseline) { const value = await abortable(sessions.materialize(baseline, input.signal), input.signal); if (value === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); if (!pending(value)) session = value; }
			return { status: "blocked", state, delivered, enterSent, ...(session ? { session } : {}), reason: snapshot.blockedReason ?? "Child requires manual resolution." };
		}

		// Boot unknown→idle is readiness only. Never interpret startup idle/done as completion.
		if (!delivered) {
			// The boot deadline covers both readiness and a pending prepare operation.
			if (input.clock.now() >= bootDeadline) return { status: "timed_out", state, delivered, enterSent, reason: "Child did not become ready." };
			// A revalidated retained pane is the sole case where done is ready for a new turn.
			if (state !== "idle" && !(input.retainedDone && state === "done")) {
				await wait(port, input, poll); continue;
			}
			// Retained sessions are already trusted and materialized; never recapture their baseline.
			if (!session && !baseline) {
				const prepared = await abortable(sessions.prepare(snapshot, input.signal), input.signal);
				if (prepared === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent);
				if (pending(prepared)) { await wait(port, input, poll); continue; }
				baseline = prepared;
			}
			if (!readyNotified) { const ready = await abortable(Promise.resolve(input.onReady?.()), input.signal); if (ready === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); readyNotified = true; }
			// No retry path below: acknowledgement or later anchor is enough to retain this one delivery.
			const sent = await abortable(port.sendLiteral(input.agentId, input.task, input.signal), input.signal);
			if (sent === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); delivered = true;
			const entered = await abortable(port.sendEnter(input.agentId, input.signal), input.signal);
			if (entered === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); enterSent = true;
			continue;
		}

		if (input.clock.now() >= deadline) return { status: "timed_out", state, delivered, enterSent, reason: "Turn did not yield a correlated native final." };
		if (!session && baseline) { const value = await abortable(sessions.materialize(baseline, input.signal), input.signal); if (value === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); if (!pending(value)) session = value; }
		if (session && !anchor) { const value = await abortable(sessions.findAnchor(session, input.turnId, input.signal), input.signal); if (value === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent); if (!pending(value)) anchor = value; }
		// Missing working events and delayed JSONL flushes are recovered by this polling loop, never resend.
		if (session && anchor && (state === "idle" || state === "done")) {
			const result = await abortable(sessions.harvest(session, input.turnId, anchor, { state }, input.signal), input.signal);
			if (result === ABORTED) return abort(port, input, state, delivered, enterSent, abortCandidateSent);
			if (!pending(result)) return { status: result.status, state, delivered, enterSent, result, session };
		}
		await wait(port, input, poll);
	}
}

async function wait(port: HerdrLifecyclePort, input: LifecycleOptions, poll: number) {
	try { if (port.waitForEvent) await port.waitForEvent(input.agentId, poll, input.signal); }
	catch { /* subscription is responsiveness only; polling getAgent remains authority. */ }
	// Keep timeout progression injectable even when an event source resolves immediately.
	await input.sleeper.sleep(poll);
}

const ABORTED = Symbol("aborted");
async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | typeof ABORTED> {
	if (!signal) return promise; if (signal.aborted) return ABORTED;
	return Promise.race([promise, new Promise<typeof ABORTED>(resolve => signal.addEventListener("abort", () => resolve(ABORTED), { once: true }))]);
}
async function abort(port: HerdrLifecyclePort, input: LifecycleOptions, state: AgentState, delivered: boolean, enterSent: boolean, sent: boolean): Promise<LifecycleResult> {
	// Never let an unresponsive RPC defeat cancellation. Cleanup remains owned and best-effort.
	void port.getAgent(input.agentId).then(async snapshot => {
		const paneId = snapshot?.paneId; if (!paneId) return;
		try { if (!sent && port.interruptOwnedPane) await port.interruptOwnedPane(paneId); if (port.closeOwnedPane) await port.closeOwnedPane(paneId); } catch { /* best effort */ }
	}).catch(() => undefined);
	return { status: "aborted", state, delivered, enterSent, abortCandidateSent: sent || !!port.interruptOwnedPane, reason: "Abort cleanup requested; graceful Pi abort remains unproven." };
}

/** Bounded scheduler preserves input order and starts no queued work after a blocked result. */
export async function runParallelLifecycle<T extends { start(): Promise<LifecycleResult> }>(items: readonly T[], concurrency = items.length): Promise<LifecycleResult[]> {
	if (items.length === 0) return [];
	if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError("concurrency must be a positive integer");
	const results: Array<LifecycleResult | undefined> = [];
	let next = 0, blocked = false;
	const worker = async () => {
		while (!blocked) {
			const index = next++;
			if (index >= items.length) return;
			const result = await items[index]!.start();
			results[index] = result;
			if (result.status === "blocked") { blocked = true; return; }
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results.filter((result): result is LifecycleResult => result !== undefined);
}

/** Chain helper has identical halt rule, with intentionally sequential start/result ordering. */
export async function runChainLifecycle<T extends { start(previous?: LifecycleResult): Promise<LifecycleResult> }>(items: readonly T[]): Promise<LifecycleResult[]> {
	const results: LifecycleResult[] = [];
	for (const item of items) {
		const result = await item.start(results.at(-1)); results.push(result);
		if (result.status !== "succeeded") break;
	}
	return results;
}
