import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ProxyRunTarget, RunTransportDelivery } from "./run-transport.js";

export const SUBAGENT_CONTROL_SOCKET_ENV = "PI_SUBAGENT_CONTROL_SOCKET";

export interface ProxySteerCommand extends ProxyRunTarget {
	type: "proxy_steer";
	message: string;
	delivery: RunTransportDelivery;
}

export interface ProxyAbortCommand extends ProxyRunTarget {
	type: "proxy_abort";
}

export type SubagentControlCommand = ProxySteerCommand | ProxyAbortCommand;

interface SubagentControlRequest extends SubagentControlCommand {
	id: string;
}

interface SubagentControlResponse {
	id: string;
	success: boolean;
	error?: string;
}

export interface SubagentControlServerHandle {
	close(): Promise<void>;
}

export function createSubagentControlSocketPath(): string {
	const id = randomUUID().replace(/-/g, "").slice(0, 12);
	if (process.platform === "win32") return `\\\\.\\pipe\\pi-subagent-control-${id}`;
	const socketDir = fs.existsSync("/tmp") ? "/tmp" : os.tmpdir();
	return path.join(socketDir, `pi-subagent-${id}.sock`);
}

export async function startSubagentControlServer(
	socketPath: string,
	handler: (command: SubagentControlCommand) => Promise<void>,
): Promise<SubagentControlServerHandle> {
	if (process.platform !== "win32") {
		try {
			await fs.promises.unlink(socketPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}

	const server = net.createServer((socket) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			while (true) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) break;
				let line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (!line.trim()) continue;
				void handleSocketLine(socket, line, handler);
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(socketPath);
	});
	if (process.platform !== "win32") {
		await fs.promises.chmod(socketPath, 0o600).catch(() => {
			// Best-effort hardening for the local control surface.
		});
	}

	return {
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
			await cleanupSubagentControlSocketPath(socketPath);
		},
	};
}

export async function sendSubagentControlCommand(socketPath: string, command: SubagentControlCommand): Promise<void> {
	const requestId = randomUUID();
	const socket = net.createConnection(socketPath);
	let buffer = "";

	await new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			socket.off("error", onError);
			socket.off("data", onData);
			socket.off("close", onClose);
		};
		const fail = (error: Error) => {
			cleanup();
			socket.destroy();
			reject(error);
		};
		const onError = (error: Error) => fail(error);
		const onClose = () => fail(new Error("Subagent control proxy disconnected before responding"));
		const onData = (chunk: Buffer | string) => {
			buffer += chunk.toString();
			while (true) {
				const newlineIndex = buffer.indexOf("\n");
				if (newlineIndex === -1) break;
				let line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				if (line.endsWith("\r")) line = line.slice(0, -1);
				if (!line.trim()) continue;
				let response: SubagentControlResponse;
				try {
					response = JSON.parse(line) as SubagentControlResponse;
				} catch {
					fail(new Error("Subagent control proxy returned invalid JSON"));
					return;
				}
				if (response.id !== requestId) continue;
				cleanup();
				socket.end();
				if (!response.success) {
					reject(new Error(response.error || "Subagent control proxy command failed"));
					return;
				}
				resolve();
				return;
			}
		};

		socket.on("error", onError);
		socket.on("data", onData);
		socket.on("close", onClose);
		socket.on("connect", () => {
			socket.write(`${JSON.stringify({ id: requestId, ...command })}\n`, (error) => {
				if (error) fail(error);
			});
		});
	});
}

export async function cleanupSubagentControlSocketPath(socketPath: string | null | undefined): Promise<void> {
	if (!socketPath || process.platform === "win32") return;
	try {
		await fs.promises.unlink(socketPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

async function handleSocketLine(
	socket: net.Socket,
	line: string,
	handler: (command: SubagentControlCommand) => Promise<void>,
): Promise<void> {
	let request: SubagentControlRequest;
	try {
		request = JSON.parse(line) as SubagentControlRequest;
	} catch {
		socket.write(`${JSON.stringify({ id: randomUUID(), success: false, error: "Invalid control proxy request JSON" })}\n`);
		return;
	}

	if (!request?.id || !request?.type) {
		socket.write(`${JSON.stringify({ id: request?.id || randomUUID(), success: false, error: "Invalid control proxy request" })}\n`);
		return;
	}

	try {
		await handler(request);
		socket.write(`${JSON.stringify({ id: request.id, success: true })}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		socket.write(`${JSON.stringify({ id: request.id, success: false, error: message })}\n`);
	}
}
