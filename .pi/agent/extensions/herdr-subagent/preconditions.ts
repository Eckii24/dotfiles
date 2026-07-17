import { constants } from "node:fs";
import { access, lstat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

import type { ErrorCode } from "./contracts.js";
import { HERDR_PROTOCOL, HerdrClient, type HerdrCapabilities } from "./herdr-client.js";

export const MAX_NESTING_DEPTH = 3;
export const PARENT_ROOT_RUN_ID_ENV = "PI_HERDR_PARENT_ROOT_RUN_ID";
export const NESTING_DEPTH_ENV = "PI_HERDR_NESTING_DEPTH";

type SocketStat = { isSocket(): boolean; isSymbolicLink(): boolean; uid: number };
type PreconditionsClient = {
	probeCapabilities(): Promise<HerdrCapabilities>;
	snapshot(): Promise<unknown>;
	dispose?(): void;
};
export type PreconditionsContext = {
	socketPath: string;
	workspaceId: string;
	callerPaneId: string;
	parentRootRunId?: string;
	nestingDepth: number;
	protocol: number;
	capabilities: HerdrCapabilities;
	piExecutable: string;
};
export type PreconditionsDependencies = {
	env?: Readonly<Record<string, string | undefined>>;
	uid?: number;
	lstat?: (path: string) => Promise<SocketStat>;
	createClient?: (socketPath: string) => PreconditionsClient;
	resolvePiExecutable?: (env: Readonly<Record<string, string | undefined>>) => Promise<string>;
};

export class PreconditionsError extends Error {
	constructor(readonly code: ErrorCode, message: string) {
		super(message);
		this.name = "PreconditionsError";
	}
}

/** Validates every external prerequisite before topology allocation. */
export async function checkPreconditions(dependencies: PreconditionsDependencies = {}): Promise<PreconditionsContext> {
	const env = dependencies.env ?? process.env;
	if (env.HERDR_ENV !== "1") fail("not_in_herdr", "Run this tool inside a Herdr-managed Pi pane.");
	const socketPath = requiredEnv(env, "HERDR_SOCKET_PATH", "missing_herdr_socket", "Restart Pi from Herdr so HERDR_SOCKET_PATH is set.");
	await validateSocket(socketPath, dependencies.lstat ?? lstat, dependencies.uid ?? process.getuid?.());
	const callerPaneId = requiredEnv(env, "HERDR_PANE_ID", "calling_pane_not_found", "Restart Pi from a Herdr pane so HERDR_PANE_ID is set.");
	const { parentRootRunId, nestingDepth } = nestingContext(env);
	const piExecutable = await (dependencies.resolvePiExecutable ?? resolvePiExecutable)(env);
	if (!isAbsolute(piExecutable)) fail("pi_integration_missing", "Configure an executable Pi path; no installation was attempted.");

	const client = (dependencies.createClient ?? defaultClient)(socketPath);
	try {
		const capabilities = await client.probeCapabilities();
		if (capabilities.protocol !== HERDR_PROTOCOL || !hasRequiredCapabilities(capabilities)) {
			fail("herdr_protocol_unsupported", `Herdr protocol ${HERDR_PROTOCOL} with required snapshot, tab, agent, pane, lifecycle, and ctrl+c support is required.`);
		}
		const snapshot = await client.snapshot();
		const caller = callerFromSnapshot(snapshot, callerPaneId);
		if (!caller) fail("calling_pane_not_found", "Caller pane is absent from Herdr snapshot; restart Pi in a live Herdr pane.");
		if (!caller.workspaceId) fail("calling_pane_not_found", "Caller pane has no Herdr workspace; restart Pi in a live Herdr workspace.");
		if (!caller.nativePi) fail("pi_integration_missing", "Herdr Pi integration is missing for caller pane; install/enable it manually, then restart Pi.");
		return { socketPath, workspaceId: caller.workspaceId, callerPaneId, ...(parentRootRunId ? { parentRootRunId } : {}), nestingDepth, protocol: capabilities.protocol, capabilities, piExecutable };
	} catch (error) {
		if (error instanceof PreconditionsError) throw error;
		throw mapClientError(error);
	} finally {
		client.dispose?.();
	}
}

function requiredEnv(env: Readonly<Record<string, string | undefined>>, name: string, code: ErrorCode, message: string): string {
	const value = env[name];
	if (typeof value !== "string" || !value.trim()) fail(code, message);
	return value;
}

async function validateSocket(path: string, stat: (path: string) => Promise<SocketStat>, uid: number | undefined) {
	let info: SocketStat;
	try { info = await stat(path); } catch { fail("missing_herdr_socket", "Herdr socket path is unavailable; restart Herdr and Pi."); }
	if (!info!.isSocket() || info!.isSymbolicLink()) fail("missing_herdr_socket", "HERDR_SOCKET_PATH is not a direct Unix socket; restart Herdr and Pi.");
	if (uid !== undefined && info!.uid !== uid) fail("missing_herdr_socket", "HERDR_SOCKET_PATH is not owned by current user; restart Herdr as this user.");
}

function nestingContext(env: Readonly<Record<string, string | undefined>>) {
	const rawDepth = env[NESTING_DEPTH_ENV];
	const nestingDepth = rawDepth === undefined ? 0 : Number(rawDepth);
	if (!Number.isInteger(nestingDepth) || nestingDepth < 0 || nestingDepth > MAX_NESTING_DEPTH) {
		fail("nesting_depth_exceeded", `Set ${NESTING_DEPTH_ENV} to an integer from 0 to ${MAX_NESTING_DEPTH}; deeper Herdr nesting is not allowed.`);
	}
	const parent = env[PARENT_ROOT_RUN_ID_ENV];
	if (parent !== undefined && (!parent.trim() || /[\p{C}]/u.test(parent) || parent.length > 128)) {
		fail("nesting_depth_exceeded", `Set ${PARENT_ROOT_RUN_ID_ENV} to a valid parent run ID or remove it.`);
	}
	if ((parent === undefined) !== (nestingDepth === 0)) {
		fail("nesting_depth_exceeded", `Set both ${PARENT_ROOT_RUN_ID_ENV} and ${NESTING_DEPTH_ENV} for nested runs.`);
	}
	return { ...(parent === undefined ? {} : { parentRootRunId: parent }), nestingDepth };
}

function hasRequiredCapabilities(value: HerdrCapabilities): boolean {
	return value.snapshot === true && value.tabs === true && value.agents === true && value.panes === true && value.layout === true && value.events === true && value.fixedInterrupt === true;
}

type Caller = { workspaceId?: string; nativePi: boolean };
function callerFromSnapshot(snapshot: unknown, callerPaneId: string): Caller | undefined {
	const root = object(snapshot);
	const body = object(root?.snapshot) ?? object(object(root?.result)?.snapshot);
	const panes = Array.isArray(body?.panes) ? body.panes : [];
	const pane = panes.find(item => object(item)?.pane_id === callerPaneId);
	if (!pane) return undefined;
	const paneRecord = object(pane)!;
	const agents = Array.isArray(body?.agents) ? body.agents : [];
	const nativePi = agents.some(item => {
		const agent = object(item); const session = object(agent?.agent_session);
		// Caller identity only proves native Pi integration. Herdr 0.7.3 reports
		// the caller session as an opaque `id`; child result harvesting still
		// independently requires a trusted `path` reference.
		return agent?.pane_id === callerPaneId && session?.source === "herdr:pi" && (session.kind === "path" || session.kind === "id");
	});
	return { workspaceId: typeof paneRecord.workspace_id === "string" && paneRecord.workspace_id ? paneRecord.workspace_id : undefined, nativePi };
}

function object(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function mapClientError(error: unknown): PreconditionsError {
	const code = object(error)?.code;
	if (code === "protocol_unsupported") return new PreconditionsError("herdr_protocol_unsupported", `Herdr protocol ${HERDR_PROTOCOL} is required; update Herdr manually.`);
	return new PreconditionsError("herdr_socket_unreachable", "Cannot connect to Herdr socket; restart Herdr and Pi.");
}

function fail(code: ErrorCode, message: string): never { throw new PreconditionsError(code, message); }

async function resolvePiExecutable(env: Readonly<Record<string, string | undefined>>): Promise<string> {
	const override = env.PI_HERDR_PI_EXECUTABLE;
	if (override !== undefined) {
		if (!isAbsolute(override)) fail("pi_integration_missing", "PI_HERDR_PI_EXECUTABLE must be an absolute executable path; no shell lookup was used.");
		return executable(override);
	}
	for (const directory of (env.PATH ?? "").split(delimiter)) {
		if (!directory) continue;
		const candidate = join(directory, "pi");
		try { return await executable(candidate); } catch { /* try next PATH entry */ }
	}
	fail("pi_integration_missing", "Pi executable is not resolvable on PATH; install/configure Pi manually.");
}

async function executable(path: string): Promise<string> {
	try { await access(path, constants.X_OK); return path; } catch { fail("pi_integration_missing", "Pi executable is not executable; configure Pi manually."); }
}

function defaultClient(socketPath: string): PreconditionsClient {
	return new HerdrClient({ socketPath });
}
