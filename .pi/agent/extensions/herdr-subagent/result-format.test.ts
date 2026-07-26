import { expect, test } from "bun:test";
import { formatResult } from "./result-format.js";

test("renders failed leaf diagnostics", () => {
	const result = formatResult({
		protocolVersion: 1,
		rootRunId: "root",
		nestingDepth: 1,
		group: "hello",
		mode: "single",
		status: "failed",
		workspaceId: "workspace",
		tabId: "tab",
		tabLabel: "tab",
		keepOpen: false,
		startedAt: 0,
		finishedAt: 1,
		warnings: [],
		children: [{
			leafRunId: "leaf",
			name: "worker",
			agent: "worker",
			cwd: "/tmp",
			paneId: "pane",
			paneLabel: "pane",
			status: "failed",
			error: { code: "child_model_error", message: "Provider rejected model" },
		}],
	});

	expect(result.content).toEqual([{ type: "text", text: "worker: failed (child_model_error) — Provider rejected model" }]);
});
