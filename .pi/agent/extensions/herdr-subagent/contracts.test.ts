import { expect, test } from "bun:test";
import {
	CONTROL_ACTIONS,
	ERROR_CODES,
	HerdrLeafResultSchema,
	HerdrPiSessionSchema,
	HerdrSubagentControlParamsSchema,
	HerdrSubagentParamsSchema,
	HerdrSubagentResultSchema,
	HerdrSubagentToolDetailsSchema,
	MAX_TIMEOUT_SECONDS,
	MIN_TIMEOUT_SECONDS,
	PROTOCOL_VERSION,
	ContractValidationError,
	createRunIds,
	displayPreview,
	makeError,
	normalizeControlParams,
	normalizeSubagentParams,
	orderLeafResults,
	sanitizeGroup,
} from "./contracts.js";

test("normalizes a strict single request and applies defaults", () => {
	const params = normalizeSubagentParams({ group: "  Café  ", agent: " worker ", task: " do work ", cwd: "/tmp" });
	expect(params).toEqual({
		group: "Café", mode: "single", agent: "worker", task: "do work", cwd: "/tmp",
		agentScope: "user", confirmProjectAgents: true, timeoutSeconds: 1800, keepOpen: false, allowSharedWorkspaceWrites: false,
	});
	expect(HerdrSubagentParamsSchema.additionalProperties).toBe(false);
	expect(HerdrSubagentControlParamsSchema.additionalProperties).toBe(false);
});

test("requires exactly one mode and complete single pairing", () => {
	for (const value of [
		{ group: "g" },
		{ group: "g", agent: "a" },
		{ group: "g", task: "t" },
		{ group: "g", agent: "a", task: "t", tasks: [{ agent: "b", task: "u" }] },
		{ group: "g", cwd: "/tmp", tasks: [{ agent: "a", task: "t" }] },
	]) expect(() => normalizeSubagentParams(value)).toThrow(ContractValidationError);
});

test("sanitizes terminal controls and counts Unicode scalars", () => {
	expect(sanitizeGroup(" \u001b[31mred\u001b[0m ")).toBe("red");
	expect(sanitizeGroup("\u001b]0;private title\u0007visible")).toBe("visible");
	expect(sanitizeGroup("a\u0000b")).toBe("ab");
	expect(sanitizeGroup("😀".repeat(60))).toBe("😀".repeat(60));
	expect(() => normalizeSubagentParams({ group: " ", agent: "a", task: "t" })).toThrow("invalid_group");
	expect(() => sanitizeGroup("😀".repeat(61))).toThrow("invalid_group");
});

test("accepts 1–4 parallel or chain items and rejects duplicate normalized names", () => {
	for (const key of ["tasks", "chain"] as const) {
		expect(normalizeSubagentParams({ group: "g", [key]: [{ agent: "a", task: "t" }] }).mode).toBe(key === "tasks" ? "parallel" : "chain");
		expect(normalizeSubagentParams({ group: "g", [key]: Array.from({ length: 4 }, (_, i) => ({ agent: `a${i}`, task: "t" })) }).items).toHaveLength(4);
		expect(() => normalizeSubagentParams({ group: "g", [key]: [] })).toThrow(ContractValidationError);
		expect(() => normalizeSubagentParams({ group: "g", [key]: Array.from({ length: 5 }, () => ({ agent: "a", task: "t" })) })).toThrow(ContractValidationError);
	}
	expect(() => normalizeSubagentParams({ group: "g", tasks: [{ name: " A ", agent: "a", task: "t" }, { name: "A", agent: "b", task: "u" }] })).toThrow(ContractValidationError);
});

test("enforces timeout bounds", () => {
	for (const timeoutSeconds of [MIN_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS]) {
		expect(normalizeSubagentParams({ group: "g", agent: "a", task: "t", timeoutSeconds }).timeoutSeconds).toBe(timeoutSeconds);
	}
	for (const timeoutSeconds of [MIN_TIMEOUT_SECONDS - 1, MAX_TIMEOUT_SECONDS + 1, 1.5]) {
		expect(() => normalizeSubagentParams({ group: "g", agent: "a", task: "t", timeoutSeconds })).toThrow(ContractValidationError);
	}
});

test("normalizes control action fields, including optional leaf resolution", () => {
	expect(normalizeControlParams({ action: "status", rootRunId: "root" })).toEqual({ action: "status", rootRunId: "root" });
	expect(normalizeControlParams({ action: "status", rootRunId: "root", leafRunId: "leaf" })).toEqual({ action: "status", rootRunId: "root", leafRunId: "leaf" });
	for (const action of ["steer", "follow_up"] as const) {
		expect(normalizeControlParams({ action, rootRunId: "root", message: "go" })).toEqual({ action, rootRunId: "root", message: "go" });
		expect(normalizeControlParams({ action, rootRunId: "root", leafRunId: "leaf", message: "go" })).toEqual({ action, rootRunId: "root", leafRunId: "leaf", message: "go" });
	}
	expect(normalizeControlParams({ action: "collect", rootRunId: "root", timeoutSeconds: 5, closeAfterCollect: true })).toEqual({ action: "collect", rootRunId: "root", timeoutSeconds: 5, closeAfterCollect: true });
	expect(normalizeControlParams({ action: "abort", rootRunId: "root", timeoutSeconds: 5 })).toEqual({ action: "abort", rootRunId: "root", timeoutSeconds: 5 });
	expect(normalizeControlParams({ action: "close", rootRunId: "root", leafRunId: "leaf" })).toEqual({ action: "close", rootRunId: "root", leafRunId: "leaf" });
	for (const value of [
		{ action: "steer", rootRunId: "root" },
		{ action: "follow_up", rootRunId: "root" },
		{ action: "status", rootRunId: "root", message: "no" },
		{ action: "close", rootRunId: "root", message: "no" },
		{ action: "close", rootRunId: "root", timeoutSeconds: 5 },
		{ action: "abort", rootRunId: "root", closeAfterCollect: true },
		{ action: "collect", rootRunId: "root", message: "no" },
	]) expect(() => normalizeControlParams(value)).toThrow(ContractValidationError);
	expect(CONTROL_ACTIONS).toEqual(["status", "steer", "follow_up", "collect", "abort", "close"]);
});

test("uses exact protocol-v1 result and details shapes", () => {
	expect(Object.keys(HerdrSubagentResultSchema.properties)).toEqual(["protocolVersion", "rootRunId", "parentRootRunId", "nestingDepth", "group", "mode", "status", "workspaceId", "tabId", "tabLabel", "keepOpen", "startedAt", "finishedAt", "children", "warnings"]);
	expect(HerdrSubagentResultSchema.required).toEqual(["protocolVersion", "rootRunId", "nestingDepth", "group", "mode", "status", "workspaceId", "tabId", "tabLabel", "keepOpen", "startedAt", "children", "warnings"]);
	expect(Object.keys(HerdrLeafResultSchema.properties)).toEqual(["leafRunId", "name", "agent", "cwd", "paneId", "paneLabel", "piSession", "status", "blockedReason", "finalOutput", "stopReason", "usage", "error"]);
	expect(HerdrLeafResultSchema.required).toEqual(["leafRunId", "name", "agent", "cwd", "paneId", "paneLabel", "status"]);
	expect(Object.keys(HerdrPiSessionSchema.properties)).toEqual(["source", "kind", "path", "sessionId", "anchorEntryId", "finalEntryId"]);
	expect(HerdrPiSessionSchema.required).toEqual(["source", "kind", "path"]);
	expect(HerdrSubagentResultSchema.additionalProperties).toBe(false);
	expect(HerdrLeafResultSchema.additionalProperties).toBe(false);
	expect(HerdrSubagentToolDetailsSchema).toBe(HerdrSubagentResultSchema);
	expect(HerdrSubagentResultSchema.properties).not.toHaveProperty("isError");
	expect(ERROR_CODES).toContain(makeError("task_anchor_missing", "Anchor absent").code);
	expect(PROTOCOL_VERSION).toBe(1);
	const ordered = orderLeafResults([{ inputIndex: 2, leafRunId: "c" }, { inputIndex: 0, leafRunId: "a" }, { inputIndex: 1, leafRunId: "b" }]);
	expect(ordered.map(item => item.leafRunId)).toEqual(["a", "b", "c"]);
});

test("omits only documented result fields", () => {
	for (const schema of [HerdrSubagentResultSchema, HerdrLeafResultSchema]) {
		expect(schema.additionalProperties).toBe(false);
	}
	expect(HerdrSubagentResultSchema.properties).not.toHaveProperty("leaves");
	expect(HerdrSubagentResultSchema.properties).not.toHaveProperty("state");
	expect(HerdrLeafResultSchema.properties).not.toHaveProperty("profile");
	expect(HerdrLeafResultSchema.properties).not.toHaveProperty("state");
	expect(makeError("task_anchor_missing", "Anchor absent")).toEqual({ code: "task_anchor_missing", message: "Anchor absent" });
});

test("uses UUID run IDs and truncates display preview only", () => {
	const ids = createRunIds();
	for (const id of [ids.rootRunId, ids.leafRunId, ids.turnId]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
	const finalOutput = "x".repeat(100);
	expect(displayPreview(finalOutput, 8)).toBe("xxxxxxx…");
	expect(finalOutput).toHaveLength(100);
});
