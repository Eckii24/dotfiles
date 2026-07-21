import { Text } from "@earendil-works/pi-tui";
import type { HerdrSubagentParams, HerdrSubagentResult } from "./contracts.js";

type RenderTheme = { fg: (color: any, text: string) => string; bold: (text: string) => string };
type RenderContext = { expanded: boolean };

const COLLAPSED_PROMPT_LIMIT = 140;

/** Compact live view: profile and task explain a running child better than model/tool internals. */
export function renderSubagentCall(args: HerdrSubagentParams, theme: RenderTheme, context: RenderContext) {
	const items = args.tasks ?? args.chain ?? (args.agent && args.task ? [{ agent: args.agent, task: args.task }] : []);
	const mode = args.tasks ? `parallel · ${items.length} panes` : args.chain ? `chain · ${items.length} steps` : "single";
	let text = theme.fg("toolTitle", theme.bold("subagent ")) + theme.fg("accent", args.group) + theme.fg("muted", ` · ${mode}`);
	for (const item of items) {
		const name = "name" in item && item.name ? `${item.name} · ` : "";
		text += `\n${theme.fg("text", `${name}${item.agent}`)}${theme.fg("muted", " · working")}`;
		text += `\n${theme.fg("dim", `  ${promptPreview(item.task, context.expanded ? undefined : COLLAPSED_PROMPT_LIMIT)}`)}`;
	}
	return new Text(text, 0, 0);
}

export function renderSubagentResult(result: { content: Array<{ type: string; text?: string }>; details?: unknown }, options: RenderContext, theme: RenderTheme) {
	if (!isSubagentResult(result.details)) return new Text(theme.fg("muted", textContent(result) || "Working…"), 0, 0);
	const details = result.details;
	const color = details.status === "succeeded" ? "success" : details.status === "blocked" ? "warning" : "error";
	let text = theme.fg(color, `${details.status === "succeeded" ? "✓" : "!"} ${details.group} · ${details.status}`);
	for (const child of details.children) {
		text += `\n${theme.fg("text", `${child.name} · ${child.agent}`)}${theme.fg("muted", ` · ${child.status}`)}`;
		if (options.expanded && child.finalOutput) text += `\n${theme.fg("dim", `  ${child.finalOutput}`)}`;
	}
	return new Text(text, 0, 0);
}

function promptPreview(prompt: string, limit?: number): string {
	const normalized = prompt.replace(/\s+/gu, " ").trim();
	if (limit === undefined || Array.from(normalized).length <= limit) return normalized;
	return `${Array.from(normalized).slice(0, Math.max(1, limit - 1)).join("")}…`;
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string | undefined {
	return result.content.find(block => block.type === "text")?.text;
}

function isSubagentResult(value: unknown): value is HerdrSubagentResult {
	return typeof value === "object" && value !== null && typeof (value as HerdrSubagentResult).group === "string" && Array.isArray((value as HerdrSubagentResult).children);
}
