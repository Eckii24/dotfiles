import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { displayPreview, type HerdrLeafResult, type HerdrSubagentResult } from "./contracts.js";

/** Safe local control handles only; never pass pane/session/launch internals here. */
export type RetainedControlHandles = { rootRunId: string; status: string; leaves: readonly { leafRunId: string; name?: string; status: string }[] };

/** Keeps UI text small; complete native correlation stays in structured details. */
export function formatResult(result: HerdrSubagentResult, retained?: RetainedControlHandles): AgentToolResult<HerdrSubagentResult> {
	const outputs = result.children.filter(child => child.finalOutput).map(child => `${child.name}: ${displayPreview(child.finalOutput!, 400)}`);
	const failures = result.children
		.filter(child => child.error)
		.map(child => `${child.name}: ${child.status} (${child.error!.code}) — ${displayPreview(child.error!.message, 400)}`);
	const blocked = result.children.find(child => child.blockedReason);
	const text = [...outputs, ...failures].length
		? [...outputs, ...failures].join("\n")
		: `${result.group}: ${result.status}${blocked?.blockedReason ? ` — ${blocked.blockedReason}` : ""}`;
	const controls = retained?.leaves.length ? `\nControl retained run: root=${retained.rootRunId} status=${retained.status}\n${retained.leaves.map(leaf => `- ${leaf.name ?? "leaf"}: leaf=${leaf.leafRunId} status=${leaf.status}`).join("\n")}\nUse subagent_control follow_up with rootRunId and leafRunId; close when done.` : "";
	return { content: [{ type: "text", text: `${text}${controls}` }], details: result };
}

export function leafText(leaf: HerdrLeafResult): string {
	return leaf.finalOutput ? displayPreview(leaf.finalOutput, 400) : `${leaf.agent}: ${leaf.status}`;
}
