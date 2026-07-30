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
	const blockedLeaves = retained?.leaves.filter(leaf => leaf.status === "blocked") ?? [];
	const succeededLeaves = retained?.leaves.filter(leaf => leaf.status === "succeeded") ?? [];
	const terminalLeaves = retained?.leaves.filter(leaf => leaf.status === "failed" || leaf.status === "aborted" || leaf.status === "timed_out" || leaf.status === "lost") ?? [];
	const guidance = blockedLeaves.length
		? "Blocked child: resolve visibly, then make one bounded subagent_control collect; never follow_up blocked child. Do not questionnaire, repeat status, or Bash sleep-poll."
		: succeededLeaves.length
			? `Use subagent_control follow_up with rootRunId and a succeeded leafRunId; close when done.${terminalLeaves.length ? " Collect terminal siblings by leafRunId when needed." : ""}`
			: "Use subagent_control collect for terminal status when needed; close retained panes when done.";
	const controls = retained?.leaves.length ? `\nControl retained run: root=${retained.rootRunId} status=${retained.status}\n${retained.leaves.map(leaf => `- ${leaf.name ?? "leaf"}: leaf=${leaf.leafRunId} status=${leaf.status}`).join("\n")}\n${guidance}` : "";
	return { content: [{ type: "text", text: `${text}${controls}` }], details: result };
}

export function leafText(leaf: HerdrLeafResult): string {
	return leaf.finalOutput ? displayPreview(leaf.finalOutput, 400) : `${leaf.agent}: ${leaf.status}`;
}
