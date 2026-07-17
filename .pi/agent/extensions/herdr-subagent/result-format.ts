import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { displayPreview, type HerdrLeafResult, type HerdrSubagentResult } from "./contracts.js";

/** Keeps UI text small; complete native correlation stays in structured details. */
export function formatResult(result: HerdrSubagentResult): AgentToolResult<HerdrSubagentResult> {
	const outputs = result.children.filter(child => child.finalOutput).map(child => `${child.name}: ${displayPreview(child.finalOutput!, 400)}`);
	const blocked = result.children.find(child => child.blockedReason);
	const text = outputs.length
		? outputs.join("\n")
		: `${result.group}: ${result.status}${blocked?.blockedReason ? ` — ${blocked.blockedReason}` : ""}`;
	return { content: [{ type: "text", text }], details: result };
}

export function leafText(leaf: HerdrLeafResult): string {
	return leaf.finalOutput ? displayPreview(leaf.finalOutput, 400) : `${leaf.agent}: ${leaf.status}`;
}
