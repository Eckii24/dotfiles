import type { AgentMessage, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { FrontmatterInjection, FrontmatterRuntimeState } from "./contracts.js";
import { loadFrontmatterInjectorSources } from "./config.js";
import { buildFrontmatterRuntimeState } from "./scan.js";

const MESSAGE_TYPE = "frontmatter-injector-refs";

interface RuntimeState {
	runtime?: FrontmatterRuntimeState;
}

function latestCustomMessageHash(ctx: ExtensionContext, customType: string): string | undefined {
	const entries = ctx.sessionManager.getBranch() as Array<{ type: string; customType?: string; details?: { hash?: string } }>;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom_message" || entry.customType !== customType) continue;
		return entry.details?.hash;
	}
	return undefined;
}

async function refreshState(state: RuntimeState, sessionRoot: string): Promise<void> {
	const configuredSources = loadFrontmatterInjectorSources(sessionRoot);
	state.runtime = await buildFrontmatterRuntimeState(sessionRoot, configuredSources);
}

function buildCustomMessage(injection: FrontmatterInjection, display: boolean) {
	return {
		customType: MESSAGE_TYPE,
		content: injection.content,
		display,
		details: {
			hash: injection.hash,
			totalRefs: injection.totalRefs,
			header: injection.header,
		},
	};
}

function renderFrontmatterMessage(
	message: { content?: string; details?: Record<string, unknown> },
	options: { expanded: boolean },
	theme: { fg: (color: string, text: string) => string; bg: (color: string, text: string) => string; bold: (text: string) => string },
) {
	const header = String(message.details?.header ?? "Memory · frontmatter refs");
	const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
	const collapsedHint = theme.fg("dim", "(Ctrl+O to expand)");
	const content = options.expanded
		? String(message.content ?? header)
		: `${theme.fg("accent", theme.bold(header))}\n${collapsedHint}`;
	box.addChild(new Text(content, 0, 0));
	return box;
}

function notifyWarnings(ctx: ExtensionContext, warnings: string[]): void {
	if (warnings.length === 0) return;
	if (ctx.hasUI) {
		ctx.ui.notify(warnings.join("\n"), "warning");
		return;
	}
	for (const warning of warnings) console.warn(warning);
}

function maybeSendInjection(pi: ExtensionAPI, ctx: ExtensionContext, injection: FrontmatterInjection | undefined): void {
	if (!injection) return;
	if (latestCustomMessageHash(ctx, MESSAGE_TYPE) === injection.hash) return;
	pi.sendMessage(buildCustomMessage(injection, true), { triggerTurn: false });
}

export default function frontmatterInjector(pi: ExtensionAPI) {
	const state: RuntimeState = {};

	pi.registerMessageRenderer(MESSAGE_TYPE, (message, options, theme) => renderFrontmatterMessage(message, options, theme));

	pi.on("session_start", async (_event, ctx) => {
		await refreshState(state, ctx.cwd);
		const runtime = state.runtime;
		if (!runtime) return;
		notifyWarnings(ctx, runtime.warnings);
		maybeSendInjection(pi, ctx, runtime.injection);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		if (!state.runtime) await refreshState(state, ctx.cwd);
		const injection = state.runtime?.injection;
		if (!injection || injection.totalRefs === 0) return undefined;
		return {
			message: buildCustomMessage(injection, false),
		};
	});

	pi.on("context", async (event, ctx) => {
		if (!state.runtime) await refreshState(state, ctx.cwd);
		const currentHash = state.runtime?.injection?.totalRefs ? state.runtime.injection.hash : undefined;
		let latestIndex = -1;
		for (let index = 0; index < event.messages.length; index += 1) {
			const message = event.messages[index] as AgentMessage & { customType?: string; details?: { hash?: string } };
			if (message.customType !== MESSAGE_TYPE) continue;
			if (currentHash && message.details?.hash === currentHash) latestIndex = index;
		}
		return {
			messages: event.messages.filter((message, index) => {
				const custom = message as AgentMessage & { customType?: string };
				if (custom.customType !== MESSAGE_TYPE) return true;
				if (!currentHash) return false;
				return index === latestIndex;
			}),
		};
	});
}
