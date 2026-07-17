import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HerdrClient } from "./herdr-client.js";

type Server = { path: string; server: net.Server; clients: Set<net.Socket>; close(): Promise<void> };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

async function fake(onData: (socket: net.Socket, frame: Record<string, unknown>) => void): Promise<Server> {
	const directory = await mkdtemp(join(tmpdir(), "pi-herdr-client-"));
	const path = join(directory, "herdr.sock"); const clients = new Set<net.Socket>(); let buffer = "";
	const server = net.createServer(socket => {
		clients.add(socket); socket.on("close", () => clients.delete(socket));
		socket.on("data", data => { buffer += data; for (;;) { const newline = buffer.indexOf("\n"); if (newline < 0) break; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line) onData(socket, JSON.parse(line)); } });
	});
	await new Promise<void>((resolve, reject) => server.listen(path, resolve).once("error", reject));
	const result = { path, server, clients, async close() { for (const socket of clients) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); } };
	servers.push(result); return result;
}
const response = (socket: net.Socket, id: unknown, result: Record<string, unknown>) => socket.write(JSON.stringify({ id, result }) + "\n");

test("queues concurrent requests FIFO on separate connections; separates partial event frames", async () => {
	const methods: string[] = []; const sockets: net.Socket[] = []; let firstResponded = false;
	const server = await fake((socket, request) => {
		methods.push(String(request.method)); sockets.push(socket);
		if (request.method === "agent.list") setTimeout(() => { firstResponded = true; response(socket, request.id, { type: "agent_list", agents: [] }); }, 15);
		else if (request.method === "session.snapshot") {
			expect(firstResponded).toBe(true);
			socket.write('{"event":"pane.agent_status_changed","data":{"pane_id":"p"}}\n{"id":');
			setTimeout(() => socket.write(JSON.stringify(request.id) + ',"result":{"type":"session_snapshot"}}\n'), 2);
		}
	});
	const client = new HerdrClient({ socketPath: server.path }); const events: unknown[] = []; client.onEvent(event => events.push(event));
	const [agents, snapshot] = await Promise.all([client.listAgents(), client.snapshot()]);
	expect(agents).toEqual({ type: "agent_list", agents: [] }); expect(snapshot).toEqual({ type: "session_snapshot" });
	expect(methods).toEqual(["agent.list", "session.snapshot"]); expect(sockets).toHaveLength(2); expect(sockets[0]).not.toBe(sockets[1]);
	expect(events).toEqual([{ event: "pane.agent_status_changed", data: { pane_id: "p" } }]); client.dispose();
});

test("accepts multiple valid frames in one aggregate larger than per-line limit", async () => {
	const server = await fake((socket, request) => { socket.write(`${JSON.stringify({ id: request.id, result: { type: "ok", n: 1 } })}\n${JSON.stringify({ event: "notice", data: { n: 2 } })}\n`); });
	const client = new HerdrClient({ socketPath: server.path, maxFrameBytes: 128 }); const events: unknown[] = []; client.onEvent(x => events.push(x));
	expect(await client.snapshot()).toMatchObject({ type: "ok" }); expect(events).toEqual([{ event: "notice", data: { n: 2 } }]); client.dispose();
});

test("maps server errors, request timeout, late response, disconnect, and abort without body leaks", async () => {
	const server = await fake((socket, request) => {
		if (request.method === "pane.get") socket.write(JSON.stringify({ id: request.id, error: { code: "denied", message: "private task body" } }) + "\n");
		else if (request.method === "pane.close") setTimeout(() => response(socket, request.id, { type: "ok" }), 40);
		else if (request.method === "agent.list") { /* wait for abort */ }
		else socket.destroy();
	});
	const client = new HerdrClient({ socketPath: server.path, requestTimeoutMs: 5 });
	await expect(client.getPane("p")).rejects.toMatchObject({ code: "server_error", message: "Herdr server error: denied" });
	await expect(client.closePane("p")).rejects.toMatchObject({ code: "request_timeout" });
	await new Promise(resolve => setTimeout(resolve, 50)); // late response must not revive request
	await expect(client.getAgent("p")).rejects.toMatchObject({ code: "disconnected" });
	const controller = new AbortController(); const pending = client.listAgents({ signal: controller.signal }); controller.abort();
	await expect(pending).rejects.toMatchObject({ code: "aborted" }); client.dispose();
});

test("rejects malformed frames and unknown IDs", async () => {
	for (const frame of ["not-json\n", '{"id":"foreign","result":{"type":"ok"}}\n']) {
		const server = await fake(socket => socket.write(frame)); const client = new HerdrClient({ socketPath: server.path });
		await expect(client.snapshot()).rejects.toMatchObject({ code: frame.startsWith("not") ? "malformed_frame" : "unknown_response" }); client.dispose(); await server.close(); servers.pop();
	}
});

test("bounds request and frame sizes", async () => {
	const server = await fake((socket, request) => { if (request.method === "session.snapshot") socket.write("x".repeat(32)); });
	const payloadClient = new HerdrClient({ socketPath: server.path, maxPayloadBytes: 50 });
	await expect(payloadClient.sendAgentInput("a", "secret".repeat(20))).rejects.toMatchObject({ code: "payload_too_large" }); payloadClient.dispose();
	const frameClient = new HerdrClient({ socketPath: server.path, maxFrameBytes: 16 });
	await expect(frameClient.snapshot()).rejects.toMatchObject({ code: "frame_too_large" }); frameClient.dispose();
});

test("rejects socket identity swap after connect before request write", async () => {
	const server = await fake(() => {}); let calls = 0;
	const stat = () => ({ isSocket: () => true, isSymbolicLink: () => false, uid: process.getuid?.() ?? 0, dev: 1, ino: ++calls < 3 ? 1 : 2 });
	const client = new HerdrClient({ socketPath: server.path, lstat: async () => stat() });
	await client.connect(); await expect(client.snapshot()).rejects.toMatchObject({ code: "socket_invalid" }); client.dispose();
});

test("validates current-user Unix socket type and idempotent disposal", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-herdr-client-")); const file = join(directory, "not-a-socket"); await writeFile(file, "x");
	const bad = new HerdrClient({ socketPath: file }); await expect(bad.connect()).rejects.toMatchObject({ code: "socket_invalid" }); bad.dispose(); bad.dispose(); await rm(directory, { recursive: true, force: true });
	const server = await fake(() => {}); const client = new HerdrClient({ socketPath: server.path, connectTimeoutMs: 10 });
	await client.connect(); client.dispose(); await expect(client.snapshot()).rejects.toMatchObject({ code: "disposed" });
});

test("times out a stalled Unix-socket connect", async () => {
	const server = await fake(() => {}); const original = net.createConnection;
	try {
		(net as unknown as { createConnection: typeof net.createConnection }).createConnection = (() => new net.Socket()) as typeof net.createConnection;
		const client = new HerdrClient({ socketPath: server.path, connectTimeoutMs: 5 });
		await expect(client.connect()).rejects.toMatchObject({ code: "connect_timeout" }); client.dispose();
	} finally {
		(net as unknown as { createConnection: typeof net.createConnection }).createConnection = original;
	}
});

test("sends start-agent focus in snake_case", async () => {
	let startParams: unknown;
	const server = await fake((socket, request) => { startParams = request.params; response(socket, request.id, { type: "agent_started" }); });
	const client = new HerdrClient({ socketPath: server.path });
	await client.startAgent({ name: "worker", argv: ["pi"], tabId: "tab-1", focus: false });
	expect(startParams).toEqual({ name: "worker", argv: ["pi"], tab_id: "tab-1", focus: false });
	client.dispose();
});

test("probes protocol 16 and exposes only fixed internal key candidates", async () => {
	const methods: string[] = []; const keyParams: unknown[] = [];
	const server = await fake((socket, request) => { methods.push(String(request.method)); if (request.method === "ping") response(socket, request.id, { type: "pong", protocol: 16, version: "0.7.3" }); else { keyParams.push(request.params); response(socket, request.id, { type: "ok" }); } });
	const client = new HerdrClient({ socketPath: server.path });
	expect(await client.probeCapabilities()).toMatchObject({ protocol: 16, fixedInterrupt: true }); await client.interruptOwnedPane("p");
	await client.submitOwnedPane("p");
	expect(keyParams).toEqual([{ pane_id: "p", keys: ["ctrl+c"] }, { pane_id: "p", keys: ["enter"] }]); expect(methods).not.toContain("agent.stop"); expect("sendKeys" in client).toBe(false); client.dispose();
});

test("rejects unsupported protocol and connect abort", async () => {
	const server = await fake((socket, request) => response(socket, request.id, { type: "pong", protocol: 15, version: "old" })); const client = new HerdrClient({ socketPath: server.path });
	await expect(client.probeCapabilities()).rejects.toMatchObject({ code: "protocol_unsupported" }); client.dispose();
	const abort = new AbortController(); abort.abort(); const cancelled = new HerdrClient({ socketPath: server.path }); await expect(cancelled.connect({ signal: abort.signal })).rejects.toMatchObject({ code: "aborted" }); cancelled.dispose();
});
