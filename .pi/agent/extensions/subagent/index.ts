import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { StringEnum } from "@mariozechner/pi-ai";
import type { Message, ToolResultMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, type AgentScope, discoverAgents, formatAgentsForPrompt } from "./agents.js";
import { SUBAGENT_CONTROL_SOCKET_ENV, startSubagentControlServer, type SubagentControlServerHandle } from "./run-control-proxy.js";
import { renderSubagentResult } from "./render-inline-tree.js";
import { buildDefaultRootSummary, getFinalOutput, toInlinePreview, toSubagentToolDetails, type LiveRunTarget, type RootRunSnapshot } from "./run-model.js";
import { SubagentRunStore } from "./run-store.js";
import { startRpcRunTransport } from "./run-transport-rpc.js";
import type { RunTransportHandle } from "./run-transport.js";
import { SubagentUIController } from "./ui/controller.js";
import { openRunNodeExecutionOverlay } from "./ui/detail-overlay.js";
import { STATUS_OVERLAY_RESERVED_WIDGET_LINES, openStatusOverlay } from "./ui/status-overlay.js";
import { openSteerCompose } from "./ui/steer-compose.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const IS_RPC_SUBAGENT_PROCESS = process.env.PI_SUBAGENT === "1";

type SubagentToolDetails = ReturnType<typeof toSubagentToolDetails>;
type OnUpdateCallback = (partial: AgentToolResult<SubagentToolDetails>) => void;

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

export default function (pi: ExtensionAPI) {
	const store = new SubagentRunStore();
	const controller = new SubagentUIController(store);
	const activeTransports = new Map<string, Map<string, RunTransportHandle>>();
	let controlServer: SubagentControlServerHandle | undefined;

	const getTransportForLiveTarget = (target: LiveRunTarget): RunTransportHandle | undefined =>
		activeTransports.get(target.transportRootRunId)?.get(target.transportLeafRunId);

	const sendSteeringToLiveTarget = async (target: LiveRunTarget, message: string, delivery: "steer" | "followUp" = "steer") => {
		const transport = getTransportForLiveTarget(target);
		if (!transport) throw new Error("No matching live child transport is currently registered for this target.");
		if (target.proxied) {
			await transport.proxySteer({
				targetRootRunId: target.targetRootRunId,
				targetLeafRunId: target.targetLeafRunId,
			}, message, delivery);
			return;
		}
		await transport.steer(message, delivery);
	};

	const abortLiveTarget = async (target: LiveRunTarget) => {
		const transport = getTransportForLiveTarget(target);
		if (!transport) throw new Error("No matching live child transport is currently registered for this target.");
		if (target.proxied) {
			await transport.proxyAbort({
				targetRootRunId: target.targetRootRunId,
				targetLeafRunId: target.targetLeafRunId,
			});
			return;
		}
		await transport.abort();
	};

	const resolveNodeLiveTarget = (targetRootRunId: string, targetLeafRunId: string): { node: NonNullable<ReturnType<typeof store.findRunNodeByTarget>>; liveTarget: LiveRunTarget } => {
		const node = store.findRunNodeByTarget(targetRootRunId, targetLeafRunId);
		const liveTarget = node?.liveTarget;
		if (!node?.leaf || !liveTarget) {
			throw new Error(`No reachable live nested control path is registered for ${targetRootRunId}/${targetLeafRunId}.`);
		}
		if (!getTransportForLiveTarget(liveTarget)) {
			throw new Error(`The transport path for ${node.title} is no longer live.`);
		}
		return { node, liveTarget };
	};

	const maybeRecordLocalSteering = (
		target: LiveRunTarget,
		entry: { id: string; text: string; delivery: "steer"; status: "queued" | "sent" | "failed"; error?: string },
	) => {
		if (target.proxied) return;
		store.recordSteeringRequest(target.transportRootRunId, target.transportLeafRunId, entry);
	};

	const setTransport = (rootRunId: string, leafRunId: string, transport: RunTransportHandle | undefined) => {
		let leafMap = activeTransports.get(rootRunId);
		if (!transport) {
			leafMap?.delete(leafRunId);
			if (leafMap && leafMap.size === 0) activeTransports.delete(rootRunId);
			store.setLiveTransport(rootRunId, leafRunId, false);
			return;
		}
		if (!leafMap) {
			leafMap = new Map();
			activeTransports.set(rootRunId, leafMap);
		}
		leafMap.set(leafRunId, transport);
		store.setLiveTransport(rootRunId, leafRunId, true);
	};

	const attachContext = (ctx: ExtensionContext) => {
		if (ctx.hasUI && !IS_RPC_SUBAGENT_PROCESS) controller.attachContext(ctx);
	};

	const startControlServerIfNeeded = async () => {
		const socketPath = process.env[SUBAGENT_CONTROL_SOCKET_ENV];
		if (!IS_RPC_SUBAGENT_PROCESS || !socketPath || controlServer) return;
		controlServer = await startSubagentControlServer(socketPath, async (command) => {
			const { liveTarget } = resolveNodeLiveTarget(command.targetRootRunId, command.targetLeafRunId);
			if (command.type === "proxy_steer") {
				const steerId = randomUUID();
				maybeRecordLocalSteering(liveTarget, {
					id: steerId,
					text: command.message,
					delivery: "steer",
					status: "queued",
				});
				try {
					await sendSteeringToLiveTarget(liveTarget, command.message, command.delivery);
					maybeRecordLocalSteering(liveTarget, {
						id: steerId,
						text: command.message,
						delivery: "steer",
						status: "sent",
					});
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					maybeRecordLocalSteering(liveTarget, {
						id: steerId,
						text: command.message,
						delivery: "steer",
						status: "failed",
						error: errorMessage,
					});
					throw error;
				}
				return;
			}
			await abortLiveTarget(liveTarget);
		});
	};

	const disposeAllTransports = async () => {
		const transports = Array.from(activeTransports.entries()).flatMap(([rootRunId, leafMap]) =>
			Array.from(leafMap.entries()).map(([leafRunId, transport]) => ({ rootRunId, leafRunId, transport }))
		);
		activeTransports.clear();
		for (const { rootRunId, leafRunId } of transports) {
			store.setLiveTransport(rootRunId, leafRunId, false);
		}
		await Promise.all(
			transports.map(async ({ transport }) => {
				try {
					await transport.abort();
				} catch {
					// ignore
				}
				await transport.dispose();
			}),
		);
	};

	const buildAdHocToolResult = (
		mode: RootRunSnapshot["mode"],
		agentScope: AgentScope,
		projectAgentsDir: string | null,
		text: string,
		isError = false,
	): AgentToolResult<SubagentToolDetails> => ({
		content: [{ type: "text", text }],
		details: toSubagentToolDetails({
			id: `adhoc-${randomUUID()}`,
			mode,
			status: isError ? "failed" : "succeeded",
			agentScope,
			projectAgentsDir,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			startedAt: Date.now(),
			endedAt: Date.now(),
			children: [],
			summaryText: text,
		}),
		isError,
	});

	const buildToolResult = (rootRunId: string, text: string, isError = false): AgentToolResult<SubagentToolDetails> => {
		const run = store.getRootRun(rootRunId);
		return run
			? {
					content: [{ type: "text", text }],
					details: toSubagentToolDetails(run),
					isError,
			  }
			: buildAdHocToolResult("single", "user", null, text, isError);
	};

	const emitUpdate = (rootRunId: string, onUpdate: OnUpdateCallback | undefined, fallbackText?: string) => {
		if (!onUpdate) return;
		const run = store.getRootRun(rootRunId);
		if (!run) return;
		onUpdate(buildToolResult(rootRunId, fallbackText ?? buildDefaultRootSummary(run)));
	};

	const confirmProjectAgentsIfNeeded = async (
		ctx: ExtensionContext,
		agents: AgentConfig[],
		discovery: ReturnType<typeof discoverAgents>,
		requestedNames: Iterable<string>,
		confirmProjectAgents: boolean,
	): Promise<boolean> => {
		if (!ctx.hasUI || !confirmProjectAgents) return true;
		const projectAgentsRequested = Array.from(new Set(requestedNames))
			.map((name) => agents.find((agent) => agent.name === name))
			.filter((agent): agent is AgentConfig => agent?.source === "project");
		if (projectAgentsRequested.length === 0) return true;

		const names = projectAgentsRequested.map((agent) => agent.name).join(", ");
		const dir = discovery.projectAgentsDir ?? "(unknown)";
		return ctx.ui.confirm(
			"Run project-local agents?",
			`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
		);
	};

	const handleTransportEvent = (rootRunId: string, leafRunId: string, event: any) => {
		switch (event.type) {
			case "assistant_message_update":
				store.upsertAssistantMessage(rootRunId, leafRunId, event.message as Message);
				break;
			case "assistant_message":
				store.upsertAssistantMessage(rootRunId, leafRunId, event.message as Message);
				break;
			case "tool_result_message":
				store.upsertToolResultMessage(rootRunId, leafRunId, event.message as ToolResultMessage<any>);
				break;
			case "tool_execution_start":
				store.updateToolExecution(rootRunId, leafRunId, event.toolName);
				break;
			case "tool_execution_update": {
				const partialText = (event.partialResult?.content ?? [])
					.filter((part: any) => part.type === "text")
					.map((part: any) => part.text)
					.join("\n")
					.trim();
				store.upsertToolResultMessage(rootRunId, leafRunId, {
					role: "toolResult",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: event.partialResult?.content ?? [],
					details: event.partialResult?.details,
					isError: false,
					timestamp: Date.now(),
				});
				store.updateToolExecution(rootRunId, leafRunId, event.toolName, partialText ? toInlinePreview(partialText, 120) : undefined);
				break;
			}
			case "tool_execution_end": {
				const finalText = (event.result?.content ?? [])
					.filter((part: any) => part.type === "text")
					.map((part: any) => part.text)
					.join("\n")
					.trim();
				store.upsertToolResultMessage(rootRunId, leafRunId, {
					role: "toolResult",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					content: event.result?.content ?? [],
					details: event.result?.details,
					isError: Boolean(event.isError),
					timestamp: Date.now(),
				});
				store.updateToolExecution(rootRunId, leafRunId, event.toolName, finalText ? toInlinePreview(finalText, 120) : undefined);
				break;
			}
			case "queue_update":
				store.setLeafQueue(rootRunId, leafRunId, event.steering ?? [], event.followUp ?? []);
				break;
		}
	};

	const runLeafAgent = async (
		ctx: ExtensionContext,
		options: {
			rootRunId: string;
			leafRunId: string;
			agents: AgentConfig[];
			agentName: string;
			task: string;
			cwd?: string;
			onUpdate?: OnUpdateCallback;
		},
	) => {
		const agent = options.agents.find((candidate) => candidate.name === options.agentName);
		if (!agent) {
			const available = options.agents.map((candidate) => `"${candidate.name}"`).join(", ") || "none";
			store.finishLeafRun({
				rootRunId: options.rootRunId,
				leafRunId: options.leafRunId,
				exitCode: 1,
				stderr: `Unknown agent: "${options.agentName}". Available agents: ${available}.`,
				errorMessage: `Unknown agent: "${options.agentName}". Available agents: ${available}.`,
			});
			emitUpdate(options.rootRunId, options.onUpdate);
			return store.getRootRun(options.rootRunId)?.children.find((child) => child.id === options.leafRunId);
		}

		store.markLeafRunning(options.rootRunId, options.leafRunId, { controllable: true });
		emitUpdate(options.rootRunId, options.onUpdate);

		let transport: RunTransportHandle | undefined;
		try {
			transport = await startRpcRunTransport({
				defaultCwd: ctx.cwd,
				agent,
				task: options.task,
				cwd: options.cwd,
				signal: ctx.signal,
				uiBridge: ctx.hasUI ? { hasUI: true, ui: ctx.ui } : undefined,
				onEvent: (event) => {
					handleTransportEvent(options.rootRunId, options.leafRunId, event);
					emitUpdate(options.rootRunId, options.onUpdate);
				},
			});
			setTransport(options.rootRunId, options.leafRunId, transport);
			const completion = await transport.completion;
			store.finishLeafRun({
				rootRunId: options.rootRunId,
				leafRunId: options.leafRunId,
				exitCode: completion.exitCode,
				stderr: completion.stderr,
				aborted: completion.aborted,
				errorMessage: completion.errorMessage,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const aborted = ctx.signal.aborted;
			store.finishLeafRun({
				rootRunId: options.rootRunId,
				leafRunId: options.leafRunId,
				exitCode: aborted ? 130 : 1,
				stderr: aborted ? "" : message,
				stopReason: aborted ? "aborted" : undefined,
				aborted,
				errorMessage: aborted ? undefined : message,
			});
		} finally {
			setTransport(options.rootRunId, options.leafRunId, undefined);
			await transport?.dispose();
			emitUpdate(options.rootRunId, options.onUpdate);
		}

		return store.getRootRun(options.rootRunId)?.children.find((child) => child.id === options.leafRunId);
	};

	pi.on("session_start", async (_event, ctx) => {
		attachContext(ctx);
		await startControlServerIfNeeded();
	});

	pi.on("session_shutdown", async () => {
		if (!IS_RPC_SUBAGENT_PROCESS) {
			controller.clearModalReservation();
			controller.clearWidget();
		}
		await controlServer?.close().catch(() => {
			// ignore
		});
		controlServer = undefined;
		await disposeAllTransports();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		attachContext(ctx);
		await startControlServerIfNeeded();
		const discovery = discoverAgents(ctx.cwd, "user");
		if (discovery.agents.length === 0) return undefined;
		const agentsBlock = formatAgentsForPrompt(discovery.agents);
		return { systemPrompt: event.systemPrompt + agentsBlock };
	});

	pi.registerCommand("subagents", {
		description: "Inspect active and recent local subagent runs",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			attachContext(ctx);
			if (!ctx.hasUI) return;
			if (controller.getActiveRuns().length === 0 && controller.getRecentRuns().length === 0) {
				ctx.ui.notify("No local subagent runs yet.", "info");
				return;
			}

			controller.suspendWidget();
			controller.reserveModalArea(STATUS_OVERLAY_RESERVED_WIDGET_LINES);
			try {
				while (true) {
					const action = await openStatusOverlay(ctx, controller);
					if (action.action === "close") return;

					const inspectNode = controller.getAnyNode(action.nodeId);
					if (action.action === "inspect") {
						if (!inspectNode) {
							ctx.ui.notify("The selected node is no longer available.", "warning");
							continue;
						}
						await openRunNodeExecutionOverlay(ctx, controller, action.nodeId, inspectNode);
						continue;
					}

					const node = controller.getNode(action.nodeId) ?? inspectNode;
					if (!node) {
						ctx.ui.notify("The selected node is no longer available.", "warning");
						continue;
					}
					const liveTarget = node.liveTarget;
					if (!node.leaf || !liveTarget) {
						ctx.ui.notify("The selected node is inspect-only or no longer live.", "warning");
						continue;
					}
					if (!getTransportForLiveTarget(liveTarget)) {
						ctx.ui.notify(`The live control path for ${node.title} is no longer available.`, "warning");
						continue;
					}

					if (action.action === "steer") {
						const message = await openSteerCompose(ctx, node, node.leaf);
						if (!message) continue;
						const steerId = randomUUID();
						maybeRecordLocalSteering(liveTarget, {
							id: steerId,
							text: message,
							delivery: "steer",
							status: "queued",
						});
						try {
							await sendSteeringToLiveTarget(liveTarget, message);
							maybeRecordLocalSteering(liveTarget, {
								id: steerId,
								text: message,
								delivery: "steer",
								status: "sent",
							});
							ctx.ui.notify(`Steering sent to ${node.leaf.agent} (${node.breadcrumb.join(" › ")}).`, "info");
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							maybeRecordLocalSteering(liveTarget, {
								id: steerId,
								text: message,
								delivery: "steer",
								status: "failed",
								error: errorMessage,
							});
							ctx.ui.notify(`Steering ${node.leaf.agent} failed: ${errorMessage}`, "error");
						}
						continue;
					}

					try {
						await abortLiveTarget(liveTarget);
						ctx.ui.notify(`Abort requested for ${node.leaf.agent} (${node.breadcrumb.join(" › ")}).`, "warning");
					} catch (error) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Abort ${node.leaf.agent} failed: ${errorMessage}`, "warning");
					}
				}
			} finally {
				controller.clearModalReservation();
				controller.resumeWidget();
			}
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default agent scope is "user" (from ~/.pi/agent/agents).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
		].join(" "),
		parameters: SubagentParams,

		async execute(toolCallId, params, _signal, onUpdate, ctx) {
			attachContext(ctx);
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			if (modeCount !== 1) {
				const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
				return {
					content: [{ type: "text", text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}` }],
					details: toSubagentToolDetails({
						id: `invalid-${toolCallId}`,
						toolCallId,
						mode: hasChain ? "chain" : hasTasks ? "parallel" : "single",
						status: "failed",
						agentScope,
						projectAgentsDir: discovery.projectAgentsDir,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						startedAt: Date.now(),
						children: [],
					}),
				};
			}

			const requestedAgents = [
				...(params.chain?.map((step) => step.agent) ?? []),
				...(params.tasks?.map((task) => task.agent) ?? []),
				...(params.agent ? [params.agent] : []),
			];
			if ((agentScope === "project" || agentScope === "both") && !(await confirmProjectAgentsIfNeeded(ctx, agents, discovery, requestedAgents, confirmProjectAgents))) {
				const mode = hasChain ? "chain" : hasTasks ? "parallel" : "single";
				return buildAdHocToolResult(mode, agentScope, discovery.projectAgentsDir, "Canceled: project-local agents not approved.", true);
			}

			if (params.chain && params.chain.length > 0) {
				const rootRunId = `subagent-${randomUUID()}`;
				store.createRootRun({
					id: rootRunId,
					toolCallId,
					mode: "chain",
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
				});
				const leafIds = params.chain.map((step, index) => {
					const leafId = `${rootRunId}:step:${index + 1}`;
					const agent = agents.find((candidate) => candidate.name === step.agent);
					store.queueLeafRun({
						rootRunId,
						leafRunId: leafId,
						agent: step.agent,
						agentSource: agent?.source ?? "unknown",
						task: step.task,
						step: index + 1,
					});
					return leafId;
				});
				emitUpdate(rootRunId, onUpdate);

				let previousOutput = "";
				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i]!;
					const leafId = leafIds[i]!;
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
					const run = await runLeafAgent(ctx, {
						rootRunId,
						leafRunId: leafId,
						agents,
						agentName: step.agent,
						task: taskWithContext,
						cwd: step.cwd,
						onUpdate,
					});

					const isError = !run || (run.status !== "succeeded" && run.status !== "running");
					if (isError) {
						for (let j = i + 1; j < leafIds.length; j++) {
							store.markLeafSkipped(rootRunId, leafIds[j]!, `skipped after step ${i + 1} failed`);
						}
						const errorText = run?.errorMessage || run?.stderr || run?.finalOutput || "(no output)";
						store.setRootSummary(rootRunId, `Chain stopped at step ${i + 1} (${step.agent}): ${errorText}`);
						return buildToolResult(rootRunId, `Chain stopped at step ${i + 1} (${step.agent}): ${errorText}`, true);
					}
					previousOutput = run.finalOutput || getFinalOutput(run.messages);
				}

				const finalRun = store.getRootRun(rootRunId)!;
				const finalOutput = finalRun.children.at(-1)?.finalOutput || "(no output)";
				store.setRootSummary(rootRunId, finalOutput);
				return buildToolResult(rootRunId, finalOutput);
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					const text = `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`;
					return buildAdHocToolResult("parallel", agentScope, discovery.projectAgentsDir, text, true);
				}

				const rootRunId = `subagent-${randomUUID()}`;
				store.createRootRun({
					id: rootRunId,
					toolCallId,
					mode: "parallel",
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
				});
				const leafIds = params.tasks.map((task, index) => {
					const leafId = `${rootRunId}:task:${index + 1}`;
					const agent = agents.find((candidate) => candidate.name === task.agent);
					store.queueLeafRun({
						rootRunId,
						leafRunId: leafId,
						agent: task.agent,
						agentSource: agent?.source ?? "unknown",
						task: task.task,
					});
					return leafId;
				});
				emitUpdate(rootRunId, onUpdate);

				await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
					await runLeafAgent(ctx, {
						rootRunId,
						leafRunId: leafIds[index]!,
						agents,
						agentName: task.agent,
						task: task.task,
						cwd: task.cwd,
						onUpdate,
					});
				});

				const finalRun = store.getRootRun(rootRunId)!;
				const successCount = finalRun.children.filter((child) => child.status === "succeeded").length;
				const summaries = finalRun.children.map((child) => {
					const preview = toInlinePreview(child.finalOutput || child.errorMessage || child.stderr || "(no output)", 100);
					return `[${child.agent}] ${child.status === "succeeded" ? "completed" : child.status}: ${preview || "(no output)"}`;
				});
				const text = `Parallel: ${successCount}/${finalRun.children.length} succeeded\n\n${summaries.join("\n\n")}`;
				store.setRootSummary(rootRunId, text);
				return buildToolResult(rootRunId, text, successCount !== finalRun.children.length);
			}

			if (params.agent && params.task) {
				const rootRunId = `subagent-${randomUUID()}`;
				store.createRootRun({
					id: rootRunId,
					toolCallId,
					mode: "single",
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
				});
				const agent = agents.find((candidate) => candidate.name === params.agent);
				const leafRunId = `${rootRunId}:single`;
				store.queueLeafRun({
					rootRunId,
					leafRunId,
					agent: params.agent,
					agentSource: agent?.source ?? "unknown",
					task: params.task,
					status: "running",
					controllable: true,
				});
				emitUpdate(rootRunId, onUpdate);
				const result = await runLeafAgent(ctx, {
					rootRunId,
					leafRunId,
					agents,
					agentName: params.agent,
					task: params.task,
					cwd: params.cwd,
					onUpdate,
				});
				const isError = !result || result.status !== "succeeded";
				const text = isError
					? `Agent ${result?.stopReason || "failed"}: ${result?.errorMessage || result?.stderr || result?.finalOutput || "(no output)"}`
					: result.finalOutput || "(no output)";
				store.setRootSummary(rootRunId, text);
				return buildToolResult(rootRunId, text, isError);
			}

			const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
			return buildAdHocToolResult("single", agentScope, discovery.projectAgentsDir, `Invalid parameters. Available agents: ${available}`, true);
		},

		renderCall(args, theme) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${cleanTask}`)}`;
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const task of args.tasks.slice(0, 3)) {
					text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${task.task}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const task = args.task || "...";
			let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", agentName) + theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", task)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, options, theme) {
			return renderSubagentResult(result, options, theme);
		},
	});

	function mapWithConcurrencyLimit<TIn, TOut>(
		items: TIn[],
		concurrency: number,
		fn: (item: TIn, index: number) => Promise<TOut>,
	): Promise<TOut[]> {
		if (items.length === 0) return Promise.resolve([]);
		const limit = Math.max(1, Math.min(concurrency, items.length));
		const results: TOut[] = new Array(items.length);
		let nextIndex = 0;
		const workers = new Array(limit).fill(null).map(async () => {
			while (true) {
				const current = nextIndex++;
				if (current >= items.length) return;
				results[current] = await fn(items[current]!, current);
			}
		});
		return Promise.all(workers).then(() => results);
	}
}
