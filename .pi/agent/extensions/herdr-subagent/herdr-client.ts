import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import net from "node:net";

export const HERDR_PROTOCOL = 16;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576;
export const DEFAULT_MAX_PAYLOAD_BYTES = 65_536;

type JsonObject = Record<string, unknown>;
export type HerdrEvent = { event: string; data: unknown };
export type HerdrResult = JsonObject;
export type HerdrSubscription = JsonObject;
export type HerdrLayout = JsonObject;

type SocketIdentity = { dev: number; ino: number; uid: number };
type SocketStat = SocketIdentity & { isSocket(): boolean; isSymbolicLink(): boolean };
export type HerdrClientOptions = {
	socketPath: string;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	maxFrameBytes?: number;
	maxPayloadBytes?: number;
	/** Test seam; production uses lstat. */
	lstat?: (path: string) => Promise<SocketStat>;
};
export type RequestOptions = { timeoutMs?: number; signal?: AbortSignal };
export type HerdrCapabilities = {
	protocol: number;
	version: string;
	snapshot: true;
	tabs: true;
	agents: true;
	panes: true;
	layout: true;
	events: true;
	fixedInterrupt: true;
};

export class HerdrClientError extends Error {
	constructor(readonly code: "socket_invalid" | "socket_unreachable" | "connect_timeout" | "request_timeout" | "aborted" | "disconnected" | "malformed_frame" | "frame_too_large" | "payload_too_large" | "unknown_response" | "server_error" | "protocol_unsupported" | "disposed", message: string) {
		super(message);
		this.name = "HerdrClientError";
	}
}

type Pending = { resolve: (result: HerdrResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; abort?: () => void };

/** Narrow protocol-16 Unix-socket client. Errors identify frames, never echo bodies. */
export class HerdrClient {
	readonly socketPath: string;
	private readonly connectTimeoutMs: number;
	private readonly requestTimeoutMs: number;
	private readonly maxFrameBytes: number;
	private readonly maxPayloadBytes: number;
	private readonly statSocket: (path: string) => Promise<SocketStat>;
	private socket?: net.Socket;
	private socketIdentity?: SocketIdentity;
	private connecting?: Promise<void>;
	private disposed = false;
	private buffer = Buffer.alloc(0);
	private readonly pending = new Map<string, Pending>();
	private queue: Promise<void> = Promise.resolve();
	private readonly listeners = new Set<(event: HerdrEvent) => void>();

	constructor(options: HerdrClientOptions) {
		this.socketPath = options.socketPath;
		this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
		this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
		this.statSocket = options.lstat ?? lstat as (path: string) => Promise<SocketStat>;
	}

	async connect(options: RequestOptions = {}): Promise<void> {
		if (this.disposed) throw new HerdrClientError("disposed", "Herdr client disposed");
		if (this.socket && !this.socket.destroyed) return;
		if (!this.connecting) this.connecting = this.open(options).finally(() => { this.connecting = undefined; });
		return this.connecting;
	}

	async probeCapabilities(options?: RequestOptions): Promise<HerdrCapabilities> {
		const result = await this.call("ping", {}, options);
		if (result.type !== "pong" || typeof result.protocol !== "number" || typeof result.version !== "string") throw new HerdrClientError("malformed_frame", "Invalid Herdr ping response");
		if (result.protocol !== HERDR_PROTOCOL) throw new HerdrClientError("protocol_unsupported", `Unsupported Herdr protocol ${result.protocol}`);
		return { protocol: result.protocol, version: result.version, snapshot: true, tabs: true, agents: true, panes: true, layout: true, events: true, fixedInterrupt: true };
	}

	snapshot(options?: RequestOptions) { return this.call("session.snapshot", {}, options); }
	createTab(params: { workspaceId?: string; cwd?: string; label?: string; env?: Record<string, string> }, options?: RequestOptions) { return this.call("tab.create", snake(params), options); }
	renameTab(tabId: string, label: string, options?: RequestOptions) { return this.call("tab.rename", { tab_id: requiredText(tabId, "tabId"), label: requiredText(label, "label") }, options); }
	closeTab(tabId: string, options?: RequestOptions) { return this.call("tab.close", { tab_id: requiredText(tabId, "tabId") }, options); }
	startAgent(params: { name: string; argv: string[]; cwd?: string; env?: Record<string, string>; tabId?: string; workspaceId?: string; split?: "right" | "down"; focus?: boolean }, options?: RequestOptions) { return this.call("agent.start", snake(params), options); }
	getAgent(target: string, options?: RequestOptions) { return this.call("agent.get", { target: requiredText(target, "target") }, options); }
	listAgents(options?: RequestOptions) { return this.call("agent.list", {}, options); }
	sendAgentInput(target: string, text: string, options?: RequestOptions) { return this.call("agent.send", { target: requiredText(target, "target"), text: requiredText(text, "text") }, options); }
	getPane(paneId: string, options?: RequestOptions) { return this.call("pane.get", { pane_id: requiredText(paneId, "paneId") }, options); }
	listPanes(workspaceId?: string, options?: RequestOptions) { return this.call("pane.list", workspaceId === undefined ? {} : { workspace_id: requiredText(workspaceId, "workspaceId") }, options); }
	processInfo(paneId?: string, options?: RequestOptions) { return this.call("pane.process_info", paneId === undefined ? {} : { pane_id: requiredText(paneId, "paneId") }, options); }
	closePane(paneId: string, options?: RequestOptions) { return this.call("pane.close", { pane_id: requiredText(paneId, "paneId") }, options); }
	applyLayout(params: { root: HerdrLayout; tabId?: string; tabLabel?: string; workspaceId?: string }, options?: RequestOptions) { return this.call("layout.apply", snake(params), options); }
	subscribe(subscriptions: readonly HerdrSubscription[], options?: RequestOptions) { if (!Array.isArray(subscriptions) || subscriptions.length === 0) throw new TypeError("subscriptions must be non-empty"); return this.call("events.subscribe", { subscriptions }, options); }
	waitForEvent(matchEvent: JsonObject, timeoutMs?: number, options?: RequestOptions) { return this.call("events.wait", { match_event: matchEvent, ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }) }, options); }
	/** Internal-only candidate: fixed ctrl+c, never caller-selected keys. */
	async interruptOwnedPane(paneId: string, options?: RequestOptions) { return this.call("pane.send_keys", { pane_id: requiredText(paneId, "paneId"), keys: ["ctrl+c"] }, options); }
	/** Internal lifecycle submit: fixed Enter, never caller-selected keys. */
	submitOwnedPane(paneId: string, options?: RequestOptions) { return this.call("pane.send_keys", { pane_id: requiredText(paneId, "paneId"), keys: ["enter"] }, options); }

	onEvent(listener: (event: HerdrEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.socket?.destroy();
		this.rejectAll(new HerdrClientError("disposed", "Herdr client disposed"));
	}

	private async open(options: RequestOptions): Promise<void> {
		const identity = await validateSocket(this.socketPath, this.statSocket);
		if (options.signal?.aborted) throw new HerdrClientError("aborted", "Herdr connect aborted");
		await new Promise<void>((resolve, reject) => {
			const socket = net.createConnection({ path: this.socketPath });
			let settled = false;
			const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener("abort", abort); error ? reject(error) : resolve(); };
			const abort = () => { socket.destroy(); finish(new HerdrClientError("aborted", "Herdr connect aborted")); };
			const timer = setTimeout(() => { socket.destroy(); finish(new HerdrClientError("connect_timeout", "Herdr connect timed out")); }, this.connectTimeoutMs);
			socket.once("connect", async () => { try { if (!sameSocket(identity, await validateSocket(this.socketPath, this.statSocket))) { socket.destroy(); return finish(new HerdrClientError("socket_invalid", "Herdr socket path changed during connect")); } this.socket = socket; this.socketIdentity = identity; this.bind(socket); finish(); } catch (error) { socket.destroy(); finish(error instanceof Error ? error : new HerdrClientError("socket_invalid", "Herdr socket path changed during connect")); } });
			socket.once("error", () => finish(new HerdrClientError("socket_unreachable", "Herdr socket unavailable")));
			options.signal?.addEventListener("abort", abort, { once: true });
		});
	}

	private bind(socket: net.Socket) {
		socket.on("data", chunk => this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		socket.on("error", () => this.disconnected(socket));
		socket.on("close", () => this.disconnected(socket));
	}
	private disconnected(socket: net.Socket) {
		if (this.socket !== socket) return;
		this.socket = undefined; this.socketIdentity = undefined;
		this.rejectAll(new HerdrClientError("disconnected", "Herdr socket disconnected"));
	}
	private receive(chunk: Buffer) {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		for (;;) {
			const newline = this.buffer.indexOf(0x0a);
			if (newline < 0) { if (this.buffer.length > this.maxFrameBytes) this.failFraming("frame_too_large", "Herdr frame exceeds limit"); return; }
			const line = this.buffer.subarray(0, newline); this.buffer = this.buffer.subarray(newline + 1);
			if (line.length === 0) continue;
			if (line.length > this.maxFrameBytes) return this.failFraming("frame_too_large", "Herdr frame exceeds limit");
			let frame: unknown;
			try { frame = JSON.parse(line.toString("utf8")); } catch { return this.failFraming("malformed_frame", "Malformed Herdr frame"); }
			this.route(frame);
		}
	}
	private route(frame: unknown) {
		if (!isObject(frame)) return this.failFraming("malformed_frame", "Invalid Herdr frame");
		if (typeof frame.id === "string") {
			const pending = this.pending.get(frame.id);
			if (!pending) return this.failFraming("unknown_response", "Unknown Herdr response ID");
			this.pending.delete(frame.id); clearTimeout(pending.timer); pending.abort?.();
			this.retireSocket();
			if (isObject(frame.error)) { pending.reject(new HerdrClientError("server_error", serverMessage(frame.error))); return; }
			if (!isObject(frame.result)) { pending.reject(new HerdrClientError("malformed_frame", "Invalid Herdr response")); return; }
			pending.resolve(frame.result);
			return;
		}
		if (typeof frame.event === "string" && "data" in frame) { for (const listener of this.listeners) listener({ event: frame.event, data: frame.data }); return; }
		this.failFraming("malformed_frame", "Invalid Herdr event");
	}
	private retireSocket() { if (this.socket) { const socket = this.socket; this.socket = undefined; this.socketIdentity = undefined; socket.destroy(); } }
	private failFraming(code: "malformed_frame" | "frame_too_large" | "unknown_response", message: string) { this.retireSocket(); this.rejectAll(new HerdrClientError(code, message)); }
	private rejectAll(error: Error) { for (const [, pending] of this.pending) { clearTimeout(pending.timer); pending.abort?.(); pending.reject(error); } this.pending.clear(); }
	private call(method: string, params: JsonObject, options: RequestOptions = {}): Promise<HerdrResult> {
		const request = this.queue.then(() => this.request(method, params, options));
		this.queue = request.then(() => undefined, () => undefined);
		return request;
	}
	private async request(method: string, params: JsonObject, options: RequestOptions): Promise<HerdrResult> {
		if (options.signal?.aborted) throw new HerdrClientError("aborted", "Herdr request aborted");
		const id = randomUUID(); const encoded = Buffer.from(JSON.stringify({ id, method, params }) + "\n");
		if (encoded.length > this.maxPayloadBytes) throw new HerdrClientError("payload_too_large", "Herdr request exceeds payload limit");
		await this.connect(options);
		if (this.disposed) throw new HerdrClientError("disposed", "Herdr client disposed");
		// Defend path replacement between connect and write.
		if (!this.socketIdentity || !sameSocket(this.socketIdentity, await validateSocket(this.socketPath, this.statSocket))) { this.retireSocket(); throw new HerdrClientError("socket_invalid", "Herdr socket path changed before request write"); }
		return new Promise<HerdrResult>((resolve, reject) => {
			const abort = () => { this.pending.delete(id); clearTimeout(timer); options.signal?.removeEventListener("abort", abort); this.retireSocket(); reject(new HerdrClientError("aborted", "Herdr request aborted")); };
			const timer = setTimeout(() => { this.pending.delete(id); options.signal?.removeEventListener("abort", abort); this.retireSocket(); reject(new HerdrClientError("request_timeout", "Herdr request timed out")); }, options.timeoutMs ?? this.requestTimeoutMs);
			this.pending.set(id, { resolve, reject, timer, abort: () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); } });
			options.signal?.addEventListener("abort", abort, { once: true });
			this.socket?.write(encoded, error => { if (error) { const pending = this.pending.get(id); if (pending) { this.pending.delete(id); clearTimeout(timer); this.retireSocket(); reject(new HerdrClientError("disconnected", "Herdr socket disconnected")); } } });
		});
	}
}

async function validateSocket(path: string, statPath: (path: string) => Promise<SocketStat>): Promise<SocketIdentity> {
	let stat: SocketStat;
	try { stat = await statPath(path); } catch { throw new HerdrClientError("socket_invalid", "Herdr socket path unavailable"); }
	if (!stat.isSocket() || stat.isSymbolicLink()) throw new HerdrClientError("socket_invalid", "Herdr socket path is not a Unix socket");
	const uid = process.getuid?.();
	if (uid !== undefined && stat.uid !== uid) throw new HerdrClientError("socket_invalid", "Herdr socket is not owned by current user");
	return { dev: stat.dev, ino: stat.ino, uid: stat.uid };
}
function sameSocket(a: SocketIdentity, b: SocketIdentity) { return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid; }
function isObject(value: unknown): value is JsonObject { return typeof value === "object" && value !== null && !Array.isArray(value); }
function requiredText(value: string, name: string) { if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be non-empty`); return value; }
function serverMessage(error: JsonObject) { return typeof error.code === "string" ? `Herdr server error: ${error.code}` : "Herdr server error"; }
function snake(params: Record<string, unknown>): JsonObject { return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined).map(([key, value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value])); }
