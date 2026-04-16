import type { AgentConfig } from "./agents.js";

export type RunTransportDelivery = "steer" | "followUp";

export interface ProxyRunTarget {
	targetRootRunId: string;
	targetLeafRunId: string;
}

export type RunTransportEvent =
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, any> }
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args: Record<string, any>;
			partialResult: { content?: Array<{ type: string; text?: string }>; details?: unknown };
	  }
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: { content?: Array<{ type: string; text?: string }>; details?: unknown };
			isError: boolean;
	  }
	| { type: "tool_result_message"; message: any }
	| { type: "assistant_message"; message: any }
	| { type: "assistant_message_update"; message: any }
	| { type: "queue_update"; steering: string[]; followUp: string[] };

export interface RunTransportUIBridge {
	hasUI: boolean;
	ui: {
		confirm(title: string, message: string): Promise<boolean>;
		select(title: string, options: string[]): Promise<string | undefined>;
		input(title: string, placeholder?: string): Promise<string | undefined>;
		editor(title: string, prefill?: string): Promise<string | undefined>;
		notify(message: string, type?: "info" | "warning" | "error"): void;
		setStatus(key: string, text: string | undefined): void;
		setWidget(key: string, lines: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
		setEditorText(text: string): void;
	};
}

export interface RunTransportStartOptions {
	defaultCwd: string;
	agent: AgentConfig;
	task: string;
	cwd?: string;
	signal?: AbortSignal;
	onEvent?: (event: RunTransportEvent) => void;
	uiBridge?: RunTransportUIBridge;
}

export interface RunTransportCompletion {
	exitCode: number;
	stderr: string;
	aborted: boolean;
	errorMessage?: string;
}

export interface RunTransportHandle {
	readonly agent: AgentConfig;
	readonly task: string;
	readonly completion: Promise<RunTransportCompletion>;
	steer(message: string, delivery?: RunTransportDelivery): Promise<void>;
	proxySteer(target: ProxyRunTarget, message: string, delivery?: RunTransportDelivery): Promise<void>;
	abort(): Promise<void>;
	proxyAbort(target: ProxyRunTarget): Promise<void>;
	dispose(): Promise<void>;
}
