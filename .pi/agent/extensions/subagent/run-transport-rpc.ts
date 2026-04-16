import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import {
	SUBAGENT_CONTROL_SOCKET_ENV,
	cleanupSubagentControlSocketPath,
	createSubagentControlSocketPath,
	sendSubagentControlCommand,
} from "./run-control-proxy.js";
import type {
	ProxyRunTarget,
	RunTransportCompletion,
	RunTransportDelivery,
	RunTransportEvent,
	RunTransportHandle,
	RunTransportStartOptions,
} from "./run-transport.js";

const SUBAGENT_ENV = "PI_SUBAGENT";

interface PendingCommand {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };
	return { command: "pi", args };
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-rpc-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

export async function startRpcRunTransport(options: RunTransportStartOptions): Promise<RunTransportHandle> {
	const transport = new RpcRunTransport(options);
	try {
		await transport.start();
		return transport;
	} catch (error) {
		await transport.dispose().catch(() => {
			// Ignore disposal failures while unwinding a startup error.
		});
		throw error;
	}
}

class RpcRunTransport implements RunTransportHandle {
	readonly agent;
	readonly task;
	readonly completion: Promise<RunTransportCompletion>;

	private readonly onEvent;
	private proc: ChildProcessWithoutNullStreams | null = null;
	private buffer = "";
	private stderr = "";
	private completed = false;
	private disposed = false;
	private abortRequested = false;
	private tmpPromptDir: string | null = null;
	private tmpPromptPath: string | null = null;
	private controlSocketPath: string | null = null;
	private readonly pending = new Map<string, PendingCommand>();
	private resolveCompletion!: (value: RunTransportCompletion) => void;
	private abortTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly options: RunTransportStartOptions) {
		this.agent = options.agent;
		this.task = options.task;
		this.onEvent = options.onEvent;
		this.completion = new Promise<RunTransportCompletion>((resolve) => {
			this.resolveCompletion = resolve;
		});
	}

	async start(): Promise<void> {
		if (this.options.signal?.aborted) {
			this.abortRequested = true;
			this.finish({ exitCode: 130, stderr: "", aborted: true });
			return;
		}

		if (this.options.signal) {
			this.options.signal.addEventListener("abort", () => {
				void this.abort();
			}, { once: true });
		}

		const args = ["--mode", "rpc", "--no-session"];
		if (this.agent.model) args.push("--model", this.agent.model);
		if (this.agent.tools && this.agent.tools.length > 0) args.push("--tools", this.agent.tools.join(","));
		if (this.agent.systemPrompt.trim()) {
			const temp = await writePromptToTempFile(this.agent.name, this.agent.systemPrompt);
			this.tmpPromptDir = temp.dir;
			this.tmpPromptPath = temp.filePath;
			args.push("--append-system-prompt", this.tmpPromptPath);
		}
		if (this.abortRequested || this.options.signal?.aborted) {
			await this.cleanupTempFiles();
			this.abortRequested = true;
			this.finish({ exitCode: 130, stderr: "", aborted: true });
			return;
		}

		this.controlSocketPath = createSubagentControlSocketPath();
		const invocation = getPiInvocation(args);
		this.proc = spawn(invocation.command, invocation.args, {
			cwd: this.options.cwd ?? this.options.defaultCwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, [SUBAGENT_ENV]: "1", [SUBAGENT_CONTROL_SOCKET_ENV]: this.controlSocketPath },
		});

		this.proc.stdout.on("data", (chunk) => this.handleStdout(chunk));
		this.proc.stderr.on("data", (chunk) => {
			this.stderr += chunk.toString();
		});
		this.proc.on("close", (code) => this.handleClose(code ?? 0));
		this.proc.on("error", (error) => {
			this.handleProcessError(error instanceof Error ? error : new Error(String(error)));
		});

		if (this.abortRequested || this.options.signal?.aborted) {
			await this.abort();
			return;
		}

		const response = await this.sendCommand({ type: "prompt", message: `Task: ${this.task}` });
		if (!response?.success) {
			const errorMessage = response?.error || `Failed to start RPC subagent ${this.agent.name}`;
			this.finish({ exitCode: 1, stderr: this.stderr, aborted: false, errorMessage });
			throw new Error(errorMessage);
		}
	}

	async steer(message: string, delivery: RunTransportDelivery = "steer"): Promise<void> {
		const command = delivery === "followUp" ? { type: "follow_up", message } : { type: "steer", message };
		const response = await this.sendCommand(command);
		if (!response?.success) {
			throw new Error(response?.error || `Failed to ${delivery} RPC subagent ${this.agent.name}`);
		}
	}

	async proxySteer(target: ProxyRunTarget, message: string, delivery: RunTransportDelivery = "steer"): Promise<void> {
		if (!this.controlSocketPath) throw new Error(`Nested control proxy is unavailable for ${this.agent.name}`);
		await sendSubagentControlCommand(this.controlSocketPath, {
			type: "proxy_steer",
			targetRootRunId: target.targetRootRunId,
			targetLeafRunId: target.targetLeafRunId,
			message,
			delivery,
		});
	}

	async abort(): Promise<void> {
		if (this.disposed || this.completed) return;
		this.abortRequested = true;
		if (!this.proc) return;
		if (!this.proc.killed) {
			void this.sendCommand({ type: "abort" }).catch(() => {
				// Ignore RPC abort failures and fall back to killing the process.
			});
			this.proc.kill("SIGTERM");
		}
		if (!this.abortTimer) {
			this.abortTimer = setTimeout(() => {
				if (this.proc && !this.completed) this.proc.kill("SIGKILL");
			}, 5000);
		}
	}

	async proxyAbort(target: ProxyRunTarget): Promise<void> {
		if (!this.controlSocketPath) throw new Error(`Nested control proxy is unavailable for ${this.agent.name}`);
		await sendSubagentControlCommand(this.controlSocketPath, {
			type: "proxy_abort",
			targetRootRunId: target.targetRootRunId,
			targetLeafRunId: target.targetLeafRunId,
		});
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		if (this.abortTimer) clearTimeout(this.abortTimer);
		if (this.proc && !this.proc.killed) {
			this.proc.kill("SIGTERM");
		}
		this.proc = null;
		await this.cleanupTempFiles();
		await cleanupSubagentControlSocketPath(this.controlSocketPath);
		this.controlSocketPath = null;
	}

	private async cleanupTempFiles(): Promise<void> {
		if (this.tmpPromptPath) {
			try {
				await fs.promises.unlink(this.tmpPromptPath);
			} catch {
				// ignore
			}
			this.tmpPromptPath = null;
		}
		if (this.tmpPromptDir) {
			try {
				await fs.promises.rmdir(this.tmpPromptDir);
			} catch {
				// ignore
			}
			this.tmpPromptDir = null;
		}
	}

	private handleStdout(chunk: Buffer | string): void {
		this.buffer += chunk.toString();
		while (true) {
			const newlineIndex = this.buffer.indexOf("\n");
			if (newlineIndex === -1) break;
			let line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		if (!line.trim()) return;
		let event: any;
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}

		if (event.type === "response") {
			const pending = event.id ? this.pending.get(event.id) : undefined;
			if (pending && event.id) {
				this.pending.delete(event.id);
				pending.resolve(event);
			}
			return;
		}

		switch (event.type) {
			case "extension_ui_request": {
				void this.handleExtensionUiRequest(event);
				break;
			}
			case "message_update": {
				if (event.message?.role === "assistant") {
					this.onEvent?.({ type: "assistant_message_update", message: event.message });
				}
				break;
			}
			case "assistant_message_end":
			case "message_end": {
				if (event.message?.role === "assistant") {
					this.onEvent?.({ type: "assistant_message", message: event.message });
				}
				if (event.message?.role === "toolResult") {
					this.onEvent?.({ type: "tool_result_message", message: event.message });
				}
				break;
			}
			case "tool_execution_start": {
				this.onEvent?.({ type: "tool_execution_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args || {} });
				break;
			}
			case "tool_execution_update": {
				this.onEvent?.({
					type: "tool_execution_update",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args || {},
					partialResult: event.partialResult || {},
				});
				break;
			}
			case "tool_execution_end": {
				this.onEvent?.({
					type: "tool_execution_end",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: event.result || {},
					isError: Boolean(event.isError),
				});
				break;
			}
			case "queue_update": {
				this.onEvent?.({ type: "queue_update", steering: event.steering || [], followUp: event.followUp || [] });
				break;
			}
			case "agent_end": {
				this.finish({ exitCode: 0, stderr: this.stderr, aborted: this.abortRequested });
				void this.dispose();
				break;
			}
		}
	}

	private handleClose(exitCode: number): void {
		if (this.abortTimer) clearTimeout(this.abortTimer);
		this.rejectPendingCommands(new Error(`RPC child exited with code ${exitCode}`));
		if (this.buffer.trim()) this.handleLine(this.buffer.trim());
		this.buffer = "";
		if (!this.completed) {
			this.finish({
				exitCode,
				stderr: this.stderr,
				aborted: this.abortRequested,
				errorMessage: exitCode !== 0 && !this.abortRequested ? `RPC subagent exited with code ${exitCode}` : undefined,
			});
		}
		void this.cleanupTempFiles();
	}

	private handleProcessError(error: Error): void {
		this.rejectPendingCommands(error);
		if (this.completed) return;
		const aborted = this.abortRequested || this.options.signal?.aborted === true;
		this.finish({
			exitCode: aborted ? 130 : 1,
			stderr: aborted ? this.stderr : this.stderr || error.message,
			aborted,
			errorMessage: aborted ? undefined : error.message,
		});
	}

	private rejectPendingCommands(error: Error): void {
		for (const [id, pending] of this.pending) {
			this.pending.delete(id);
			pending.reject(error);
		}
	}

	private async handleExtensionUiRequest(event: any): Promise<void> {
		const method = event.method as string | undefined;
		if (!event.id || !method) return;
		const bridge = this.options.uiBridge;

		if (method === "notify") {
			bridge?.hasUI && bridge.ui.notify(event.message, event.notifyType ?? "info");
			return;
		}
		if (method === "setStatus") {
			bridge?.hasUI && bridge.ui.setStatus(event.statusKey, event.statusText);
			return;
		}
		if (method === "setWidget") {
			// Widgets are session-top-level UI. Ignore child widget traffic so nested RPC runs cannot clobber the parent widget.
			return;
		}
		if (method === "set_editor_text") {
			bridge?.hasUI && bridge.ui.setEditorText(event.text || "");
			return;
		}

		try {
			if (bridge?.hasUI) {
				switch (method) {
					case "confirm": {
						const confirmed = await bridge.ui.confirm(event.title, event.message || "");
						await this.sendRaw({ type: "extension_ui_response", id: event.id, confirmed });
						return;
					}
					case "select": {
						const value = await bridge.ui.select(event.title, Array.isArray(event.options) ? event.options : []);
						await this.sendRaw(
							value === undefined
								? { type: "extension_ui_response", id: event.id, cancelled: true }
								: { type: "extension_ui_response", id: event.id, value },
						);
						return;
					}
					case "input": {
						const value = await bridge.ui.input(event.title, event.placeholder);
						await this.sendRaw(
							value === undefined
								? { type: "extension_ui_response", id: event.id, cancelled: true }
								: { type: "extension_ui_response", id: event.id, value },
						);
						return;
					}
					case "editor": {
						const value = await bridge.ui.editor(event.title, event.prefill || "");
						await this.sendRaw(
							value === undefined
								? { type: "extension_ui_response", id: event.id, cancelled: true }
								: { type: "extension_ui_response", id: event.id, value },
						);
						return;
					}
				}
			}
			await this.sendRaw({ type: "extension_ui_response", id: event.id, cancelled: true });
		} catch {
			// Ignore child UI-response failures; the child process will fail independently if needed.
		}
	}

	private finish(result: RunTransportCompletion): void {
		if (this.completed) return;
		this.completed = true;
		this.resolveCompletion(result);
	}

	private sendRaw(payload: Record<string, unknown>): Promise<void> {
		if (!this.proc?.stdin.writable) return Promise.reject(new Error("RPC child stdin is not writable"));
		return new Promise((resolve, reject) => {
			this.proc?.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	private sendCommand(command: Record<string, unknown>): Promise<any> {
		const id = randomUUID();
		const payload = { id, ...command };
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.sendRaw(payload).catch((error) => {
				this.pending.delete(id);
				reject(error);
			});
		});
	}
}
