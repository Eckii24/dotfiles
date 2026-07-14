import { join } from "node:path";
import { formatSkillsForPrompt, getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadModes, replaceSkillIndex, selectModeSkills, type ModeDefinition } from "./definitions.js";
import { resolveModelReference } from "../shared/model-reference.js";

const MODE_STATE_ENTRY_TYPE = "pi-modes-active-mode";

interface ModeState {
	version: 1;
	command: string;
}

function parseProviderModel(value: string): { provider: string; modelId: string } {
	const separator = value.indexOf("/");
	return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) };
}

function getLatestModeState(ctx: ExtensionContext): ModeState | undefined {
	const entries = ctx.sessionManager.getBranch() as Array<{ type: string; customType?: string; data?: unknown }>;
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== MODE_STATE_ENTRY_TYPE) continue;
		if (entry.data && typeof entry.data === "object") {
			const state = entry.data as Partial<ModeState>;
			if (state.version === 1 && typeof state.command === "string") return state as ModeState;
		}
	}
	return undefined;
}

function describeModeValue(value: string | string[] | undefined): string {
	if (value === undefined) return "inherit";
	return Array.isArray(value) ? value.join(", ") : value;
}

function buildModePrompt(mode: ModeDefinition, systemPrompt: string): string {
	return `${systemPrompt}\n\n<active_mode command="${mode.command}" model="${mode.model}">\n${mode.systemPrompt}\n</active_mode>`;
}

async function activateMode(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext | ExtensionContext,
	mode: ModeDefinition,
	persist: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (mode.tools) {
		const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
		const unavailableTools = mode.tools.filter((tool) => !availableTools.has(tool));
		if (unavailableTools.length > 0) return { ok: false, reason: `Mode ${mode.command} requests unavailable tools: ${unavailableTools.join(", ")}` };
	}

	if (mode.model) {
		let qualifiedModel: string;
		try {
			qualifiedModel = resolveModelReference(mode.model);
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		const { provider, modelId } = parseProviderModel(qualifiedModel);
		const model = ctx.modelRegistry.find(provider, modelId);
		if (!model) return { ok: false, reason: `Model unavailable: ${mode.model}` };
		if (!(await pi.setModel(model))) return { ok: false, reason: `Authentication unavailable for model: ${mode.model}` };
	}

	if (mode.tools) pi.setActiveTools(mode.tools);
	if (mode.thinking) pi.setThinkingLevel(mode.thinking);
	if (persist) pi.appendEntry(MODE_STATE_ENTRY_TYPE, { version: 1, command: mode.command } satisfies ModeState);
	return { ok: true };
}

export default function (pi: ExtensionAPI) {
	const modesDir = join(getAgentDir(), "modes");
	let modes: ModeDefinition[] = [];
	let activeMode: ModeDefinition | undefined;

	try {
		modes = loadModes(modesDir);
	} catch (error) {
		console.error(`[modes] ${error instanceof Error ? error.message : String(error)}`);
	}

	for (const mode of modes) {
		pi.registerCommand(mode.command, {
			description: mode.description,
			handler: async (_args, ctx) => {
				const result = await activateMode(pi, ctx, mode, true);
				if (!result.ok) {
					ctx.ui.notify(`Mode not activated: ${result.reason}`, "error");
					return;
				}
				activeMode = mode;
				ctx.ui.notify(`Mode active: /${mode.command} — model: ${describeModeValue(mode.model)}; tools: ${describeModeValue(mode.tools)}; thinking: ${describeModeValue(mode.thinking)}`, "info");
			},
		});
	}

	pi.registerCommand("modes", {
		description: "Show installed modes and the active mode",
		handler: async (_args, ctx) => {
			const lines = modes.map((mode) => `${activeMode?.command === mode.command ? "*" : "-"} /${mode.command}: model=${describeModeValue(mode.model)}; tools=${describeModeValue(mode.tools)}; thinking=${describeModeValue(mode.thinking)}`);
			ctx.ui.notify(lines.length > 0 ? lines.join("\n") : "No Markdown modes found in ~/.pi/agent/modes/.", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const state = getLatestModeState(ctx);
		if (!state) return;
		const mode = modes.find((candidate) => candidate.command === state.command);
		if (!mode) {
			if (ctx.hasUI) ctx.ui.notify(`Saved mode no longer exists: /${state.command}`, "warning");
			return;
		}
		const result = await activateMode(pi, ctx, mode, false);
		if (!result.ok) {
			if (ctx.hasUI) ctx.ui.notify(`Saved mode not restored: ${result.reason}`, "warning");
			return;
		}
		activeMode = mode;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!activeMode) return undefined;
		try {
			let systemPrompt = ctx.getSystemPrompt();
			if (activeMode.skills !== undefined) {
				const availableSkills = event.systemPromptOptions.skills ?? [];
				const selectedSkills = selectModeSkills(activeMode.skills, availableSkills);
				systemPrompt = replaceSkillIndex(
					systemPrompt,
					formatSkillsForPrompt(availableSkills),
					formatSkillsForPrompt(selectedSkills),
				);
			}
			return { systemPrompt: buildModePrompt(activeMode, systemPrompt) };
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				systemPrompt: `${event.systemPrompt}\n\n<active_mode_configuration_error>\n${reason}\nDo not execute the user's task. Explain the mode configuration error and stop.\n</active_mode_configuration_error>`,
			};
		}
	});
}
