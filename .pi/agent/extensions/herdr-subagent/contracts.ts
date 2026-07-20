import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

export const PROTOCOL_VERSION = 1 as const;
export const MIN_TIMEOUT_SECONDS = 1;
/** Public timeout ceiling: one day, preventing unbounded tool calls. */
export const MAX_TIMEOUT_SECONDS = 86400;
/** Default public operation timeout: 30 minutes. */
export const DEFAULT_TIMEOUT_SECONDS = 1800;

export const AGENT_SCOPES = ["user", "project", "both"] as const;
export const CONTROL_ACTIONS = ["status", "steer", "follow_up", "collect", "abort", "close"] as const;
export const LEAF_STATES = ["queued", "booting", "working", "blocked", "succeeded", "failed", "aborted", "timed_out", "lost"] as const;
export const ROOT_STATES = ["succeeded", "blocked", "failed", "aborted", "timed_out"] as const;
export const ERROR_CODES = [
	"not_in_herdr", "missing_herdr_socket", "herdr_socket_unreachable", "herdr_protocol_unsupported", "calling_pane_not_found",
	"pi_integration_missing", "agent_profile_not_found", "agent_profile_invalid", "project_agent_not_confirmed", "invalid_execution_mode",
	"invalid_group", "tab_capacity_exceeded", "pane_capacity_exceeded", "nesting_depth_exceeded", "shared_workspace_write_conflict",
	"tab_create_failed", "agent_start_failed", "child_boot_timeout", "task_delivery_failed", "task_anchor_missing", "child_blocked",
	"turn_timeout", "pane_lost", "session_reference_missing", "session_path_untrusted", "session_parse_failed", "ambiguous_turn",
	"empty_final_output", "result_unavailable", "child_model_error", "child_aborted", "cleanup_incomplete", "unknown_or_foreign_run",
] as const;

const Strict = { additionalProperties: false } as const;
const AgentScopeSchema = StringEnum(AGENT_SCOPES);
const ControlActionSchema = StringEnum(CONTROL_ACTIONS);
const LeafStateSchema = StringEnum(LEAF_STATES);
const RootStateSchema = StringEnum(ROOT_STATES);
const ErrorCodeSchema = StringEnum(ERROR_CODES);

export const HerdrSubagentItemSchema = Type.Object({
	name: Type.Optional(Type.String()),
	agent: Type.String({ description: "Agent profile name. Profiles declaring edit or write are writers." }),
	task: Type.String(),
	cwd: Type.Optional(Type.String({ description: "Existing working directory. Parallel writers require distinct canonical cwd values." })),
}, Strict);

/** Strict wire schema; cross-field mode rules are enforced by normalizeSubagentParams. */
export const HerdrSubagentParamsSchema = Type.Object({
	group: Type.String(),
	agent: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
	cwd: Type.Optional(Type.String()),
	tasks: Type.Optional(Type.Array(HerdrSubagentItemSchema, { minItems: 1, maxItems: 4, description: "Parallel panes. Give every declared writer a distinct canonical cwd." })),
	chain: Type.Optional(Type.Array(HerdrSubagentItemSchema, { minItems: 1, maxItems: 4, description: "Sequential panes; use for multiple writers sharing one cwd." })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(Type.Boolean()),
	timeoutSeconds: Type.Optional(Type.Integer({ minimum: MIN_TIMEOUT_SECONDS, maximum: MAX_TIMEOUT_SECONDS })),
	keepOpen: Type.Optional(Type.Boolean()),
	allowSharedWorkspaceWrites: Type.Optional(Type.Boolean({ description: "Dangerous override for concurrent writers sharing a canonical cwd. Use only with explicit user acceptance of conflict risk." })),
}, Strict);

/** Strict wire schema; action-specific rules are enforced by normalizeControlParams. */
export const HerdrSubagentControlParamsSchema = Type.Object({
	action: ControlActionSchema,
	rootRunId: Type.String(),
	leafRunId: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	timeoutSeconds: Type.Optional(Type.Integer({ minimum: MIN_TIMEOUT_SECONDS, maximum: MAX_TIMEOUT_SECONDS })),
	closeAfterCollect: Type.Optional(Type.Boolean()),
}, Strict);

export const HerdrErrorSchema = Type.Object({
	code: ErrorCodeSchema,
	message: Type.String(),
}, Strict);

export const HerdrPiSessionSchema = Type.Object({
	source: Type.Literal("herdr:pi"),
	kind: Type.Literal("path"),
	path: Type.String(),
	sessionId: Type.Optional(Type.String()),
	anchorEntryId: Type.Optional(Type.String()),
	finalEntryId: Type.Optional(Type.String()),
}, Strict);

export const HerdrLeafResultSchema = Type.Object({
	leafRunId: Type.String(),
	name: Type.String(),
	agent: Type.String(),
	cwd: Type.String(),
	paneId: Type.String(),
	paneLabel: Type.String(),
	piSession: Type.Optional(HerdrPiSessionSchema),
	status: LeafStateSchema,
	blockedReason: Type.Optional(Type.String()),
	finalOutput: Type.Optional(Type.String()),
	stopReason: Type.Optional(Type.String()),
	usage: Type.Optional(Type.Unknown()),
	error: Type.Optional(HerdrErrorSchema),
}, Strict);

export const HerdrSubagentResultSchema = Type.Object({
	protocolVersion: Type.Literal(PROTOCOL_VERSION),
	rootRunId: Type.String(),
	parentRootRunId: Type.Optional(Type.String()),
	nestingDepth: Type.Integer({ minimum: 0 }),
	group: Type.String(),
	mode: StringEnum(["single", "parallel", "chain"] as const),
	status: RootStateSchema,
	workspaceId: Type.String(),
	tabId: Type.String(),
	tabLabel: Type.String(),
	keepOpen: Type.Boolean(),
	startedAt: Type.Number(),
	finishedAt: Type.Optional(Type.Number()),
	children: Type.Array(HerdrLeafResultSchema),
	warnings: Type.Array(Type.String()),
}, Strict);

/** Tool details are the root result directly; never wrap it or add isError. */
export const HerdrSubagentToolDetailsSchema = HerdrSubagentResultSchema;

/** Untrusted socket payload; Herdr client narrows this before use. */
export type RawHerdrFrame = unknown;

export type HerdrSubagentParams = Static<typeof HerdrSubagentParamsSchema>;
export type HerdrSubagentControlParams = Static<typeof HerdrSubagentControlParamsSchema>;
export type HerdrError = Static<typeof HerdrErrorSchema>;
export type HerdrLeafResult = Static<typeof HerdrLeafResultSchema>;
export type HerdrSubagentResult = Static<typeof HerdrSubagentResultSchema>;
export type HerdrSubagentToolDetails = Static<typeof HerdrSubagentToolDetailsSchema>;
export type ErrorCode = typeof ERROR_CODES[number];
export type ControlAction = typeof CONTROL_ACTIONS[number];

export type NormalizedItem = { name: string; agent: string; task: string; cwd?: string; inputIndex: number };
export type NormalizedSubagentParams = {
	group: string;
	mode: "single" | "parallel" | "chain";
	agentScope: typeof AGENT_SCOPES[number];
	confirmProjectAgents: boolean;
	timeoutSeconds: number;
	keepOpen: boolean;
	allowSharedWorkspaceWrites: boolean;
	agent?: string;
	task?: string;
	cwd?: string;
	items?: NormalizedItem[];
};
export type NormalizedControlParams =
	| { action: "status"; rootRunId: string; leafRunId?: string }
	| { action: "steer" | "follow_up"; rootRunId: string; leafRunId?: string; message: string }
	| { action: "collect"; rootRunId: string; leafRunId?: string; timeoutSeconds?: number; closeAfterCollect?: boolean }
	| { action: "abort"; rootRunId: string; leafRunId?: string; timeoutSeconds?: number }
	| { action: "close"; rootRunId: string; leafRunId?: string };

export class ContractValidationError extends Error {
	readonly code: ErrorCode;
	constructor(code: ErrorCode, message: string) {
		super(`${code}: ${message}`);
		this.name = "ContractValidationError";
		this.code = code;
	}
}

export function makeError(code: ErrorCode, message: string): HerdrError {
	return { code, message };
}

function invalid(code: ErrorCode, message: string): never {
	throw new ContractValidationError(code, message);
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("invalid_execution_mode", "params must be an object");
	return value as Record<string, unknown>;
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[]) {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid("invalid_execution_mode", `unexpected field ${key}`);
}

function text(value: unknown, field: string, code: ErrorCode = "invalid_execution_mode"): string {
	if (typeof value !== "string") invalid(code, `${field} must be a string`);
	const normalized = value.normalize("NFKC").trim();
	if (!normalized) invalid(code, `${field} must be non-empty`);
	return normalized;
}

/** Removes terminal controls before group text reaches a tab label. */
export function sanitizeGroup(value: unknown): string {
	if (typeof value !== "string") invalid("invalid_group", "group must be a string");
	const sanitized = value.normalize("NFKC")
		.replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, "")
		.replace(/(?:\u001B\]|\u009D)[\s\S]*?(?:\u0007|\u001B\\|\u009C)/gu, "")
		.replace(/[\p{C}]/gu, "")
		.trim();
	if (!sanitized || Array.from(sanitized).length > 60) invalid("invalid_group", "group must contain 1–60 Unicode scalar values");
	return sanitized;
}

function taskText(value: unknown, field: string): string {
	const normalized = text(value, field);
	if (/[\r\n]/.test(normalized)) invalid("invalid_execution_mode", `${field} must be newline-free`);
	return normalized;
}

function optionalText(value: unknown, field: string): string | undefined {
	return value === undefined ? undefined : text(value, field);
}

function timeout(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_TIMEOUT_SECONDS || value > MAX_TIMEOUT_SECONDS) {
		invalid("invalid_execution_mode", `timeoutSeconds must be an integer from ${MIN_TIMEOUT_SECONDS} to ${MAX_TIMEOUT_SECONDS}`);
	}
	return value;
}

function bool(value: unknown, field: string, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") invalid("invalid_execution_mode", `${field} must be a boolean`);
	return value;
}

function normalizeItems(value: unknown, field: "tasks" | "chain"): NormalizedItem[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 4) invalid("invalid_execution_mode", `${field} must contain 1–4 items`);
	const names = new Set<string>();
	return value.map((raw, inputIndex) => {
		const item = record(raw);
		onlyFields(item, ["name", "agent", "task", "cwd"]);
		const name = optionalText(item.name, `${field}[${inputIndex}].name`) ?? `${field}-${inputIndex + 1}`;
		const normalizedName = name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
		if (names.has(normalizedName)) invalid("invalid_execution_mode", `duplicate normalized item name ${name}`);
		names.add(normalizedName);
		return { name, agent: text(item.agent, `${field}[${inputIndex}].agent`), task: taskText(item.task, `${field}[${inputIndex}].task`), cwd: optionalText(item.cwd, `${field}[${inputIndex}].cwd`), inputIndex };
	});
}

export function normalizeSubagentParams(raw: unknown): NormalizedSubagentParams {
	const value = record(raw);
	onlyFields(value, ["group", "agent", "task", "cwd", "tasks", "chain", "agentScope", "confirmProjectAgents", "timeoutSeconds", "keepOpen", "allowSharedWorkspaceWrites"]);
	const group = sanitizeGroup(value.group);
	const hasSingle = value.agent !== undefined || value.task !== undefined || value.cwd !== undefined;
	const hasTasks = value.tasks !== undefined;
	const hasChain = value.chain !== undefined;
	if (Number(hasSingle) + Number(hasTasks) + Number(hasChain) !== 1) invalid("invalid_execution_mode", "provide exactly one of single, tasks, or chain");
	const agentScope = value.agentScope === undefined ? "user" : text(value.agentScope, "agentScope");
	if (!(AGENT_SCOPES as readonly string[]).includes(agentScope)) invalid("invalid_execution_mode", "agentScope is invalid");
	const base = { group, agentScope: agentScope as typeof AGENT_SCOPES[number], confirmProjectAgents: bool(value.confirmProjectAgents, "confirmProjectAgents", true), timeoutSeconds: timeout(value.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS, keepOpen: bool(value.keepOpen, "keepOpen", false), allowSharedWorkspaceWrites: bool(value.allowSharedWorkspaceWrites, "allowSharedWorkspaceWrites", false) };
	if (hasTasks) return { ...base, mode: "parallel", items: normalizeItems(value.tasks, "tasks") };
	if (hasChain) return { ...base, mode: "chain", items: normalizeItems(value.chain, "chain") };
	if (value.agent === undefined || value.task === undefined) invalid("invalid_execution_mode", "single mode requires agent and task");
	return { ...base, mode: "single", agent: text(value.agent, "agent"), task: taskText(value.task, "task"), cwd: optionalText(value.cwd, "cwd") };
}

export function normalizeControlParams(raw: unknown): NormalizedControlParams {
	const value = record(raw);
	onlyFields(value, ["action", "rootRunId", "leafRunId", "message", "timeoutSeconds", "closeAfterCollect"]);
	const action = text(value.action, "action");
	if (!(CONTROL_ACTIONS as readonly string[]).includes(action)) invalid("unknown_or_foreign_run", "control action is invalid");
	const rootRunId = text(value.rootRunId, "rootRunId", "unknown_or_foreign_run");
	const leafRunId = optionalText(value.leafRunId, "leafRunId");
	const message = optionalText(value.message, "message");
	const timeoutSeconds = timeout(value.timeoutSeconds);
	const closeAfterCollect = value.closeAfterCollect === undefined ? undefined : bool(value.closeAfterCollect, "closeAfterCollect", false);
	if (action === "status") {
		if (message || timeoutSeconds !== undefined || closeAfterCollect !== undefined) invalid("invalid_execution_mode", "status accepts rootRunId and optional leafRunId only");
		return { action, rootRunId, ...(leafRunId ? { leafRunId } : {}) };
	}
	if (action === "steer" || action === "follow_up") {
		if (!message || timeoutSeconds !== undefined || closeAfterCollect !== undefined) invalid("invalid_execution_mode", `${action} requires message and accepts optional leafRunId only`);
		return { action, rootRunId, ...(leafRunId ? { leafRunId } : {}), message };
	}
	if (action === "collect") {
		if (message) invalid("invalid_execution_mode", "collect does not accept message");
		return { action, rootRunId, ...(leafRunId ? { leafRunId } : {}), ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }), ...(closeAfterCollect === undefined ? {} : { closeAfterCollect }) };
	}
	if (action === "abort") {
		if (message || closeAfterCollect !== undefined) invalid("invalid_execution_mode", "abort accepts rootRunId, optional leafRunId, and optional timeoutSeconds only");
		return { action, rootRunId, ...(leafRunId ? { leafRunId } : {}), ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }) };
	}
	if (message || timeoutSeconds !== undefined || closeAfterCollect !== undefined) invalid("invalid_execution_mode", "close accepts rootRunId and optional leafRunId only");
	return { action: "close", rootRunId, ...(leafRunId ? { leafRunId } : {}) };
}

export function createRunIds(): { rootRunId: string; leafRunId: string; turnId: string } {
	return { rootRunId: randomUUID(), leafRunId: randomUUID(), turnId: randomUUID() };
}

export function orderLeafResults<T extends { inputIndex: number }>(leaves: readonly T[]): T[] {
	return [...leaves].sort((left, right) => left.inputIndex - right.inputIndex);
}

/** Display-only helper. Structured finalOutput remains untouched. */
export function displayPreview(text: string, maxScalars: number): string {
	if (!Number.isInteger(maxScalars) || maxScalars < 1) throw new RangeError("maxScalars must be a positive integer");
	const scalars = Array.from(text);
	return scalars.length <= maxScalars ? text : `${scalars.slice(0, maxScalars - 1).join("")}…`;
}
