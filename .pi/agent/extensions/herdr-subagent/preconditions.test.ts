import { expect, test } from "bun:test";

import { HERDR_PROTOCOL, type HerdrCapabilities } from "./herdr-client.js";
import { checkPreconditions, MAX_NESTING_DEPTH, PreconditionsError } from "./preconditions.js";

type FakeClient = { probeCapabilities(): Promise<HerdrCapabilities>; snapshot(): Promise<unknown>; dispose(): void };
const capabilities: HerdrCapabilities = { protocol: HERDR_PROTOCOL, version: "0.7.3", snapshot: true, tabs: true, agents: true, panes: true, layout: true, events: true, fixedInterrupt: true };
const callerSnapshot = { snapshot: { panes: [{ pane_id: "pane-1", workspace_id: "workspace-1" }], agents: [{ pane_id: "pane-1", agent_session: { source: "herdr:pi", kind: "path", value: "/redacted/session.jsonl" } }] } };

function baseEnv(extra: Record<string, string | undefined> = {}) {
	return { HERDR_ENV: "1", HERDR_SOCKET_PATH: "/runtime/herdr.sock", HERDR_PANE_ID: "pane-1", ...extra };
}
function setup(extra: { env?: Record<string, string | undefined>; stat?: { isSocket(): boolean; isSymbolicLink(): boolean; uid: number }; capabilities?: HerdrCapabilities; snapshot?: unknown; probeError?: unknown; snapshotError?: unknown } = {}) {
	let clients = 0; let executableResolutions = 0; let disposed = 0;
	const client: FakeClient = {
		async probeCapabilities() { if (extra.probeError) throw extra.probeError; return extra.capabilities ?? capabilities; },
		async snapshot() { if (extra.snapshotError) throw extra.snapshotError; return extra.snapshot ?? callerSnapshot; },
		dispose() { disposed += 1; },
	};
	return {
		clients: () => clients, executableResolutions: () => executableResolutions, disposed: () => disposed,
		dependencies: {
			env: extra.env ?? baseEnv(), uid: 1000,
			lstat: async () => extra.stat ?? { isSocket: () => true, isSymbolicLink: () => false, uid: 1000 },
			createClient: () => { clients += 1; return client; },
			resolvePiExecutable: async () => { executableResolutions += 1; return "/usr/local/bin/pi"; },
		},
	};
}

async function expectCode(run: Promise<unknown>, code: string) {
	await expect(run).rejects.toMatchObject({ code });
}

test("fails closed for HERDR_ENV before filesystem, executable resolution, or client allocation", async () => {
	const fixture = setup({ env: baseEnv({ HERDR_ENV: "true" }) });
	await expectCode(checkPreconditions(fixture.dependencies), "not_in_herdr");
	expect(fixture.clients()).toBe(0); expect(fixture.executableResolutions()).toBe(0);
});

test("rejects missing socket, invalid socket type, foreign socket, and missing caller pane before client allocation", async () => {
	for (const extra of [
		{ env: baseEnv({ HERDR_SOCKET_PATH: undefined }), code: "missing_herdr_socket" },
		{ stat: { isSocket: () => false, isSymbolicLink: () => false, uid: 1000 }, code: "missing_herdr_socket" },
		{ stat: { isSocket: () => true, isSymbolicLink: () => false, uid: 2000 }, code: "missing_herdr_socket" },
		{ env: baseEnv({ HERDR_PANE_ID: undefined }), code: "calling_pane_not_found" },
	]) {
		const fixture = setup(extra); await expectCode(checkPreconditions(fixture.dependencies), extra.code);
		expect(fixture.clients()).toBe(0); expect(fixture.executableResolutions()).toBe(extra.code === "calling_pane_not_found" ? 0 : 0);
	}
});

test("requires a local executable before connecting to Herdr", async () => {
	const fixture = setup();
	fixture.dependencies.resolvePiExecutable = async () => { throw new PreconditionsError("pi_integration_missing", "Configure Pi manually."); };
	await expectCode(checkPreconditions(fixture.dependencies), "pi_integration_missing");
	expect(fixture.clients()).toBe(0);
});

test("maps refused sockets and protocol/capability failures without topology side effects", async () => {
	for (const extra of [
		{ probeError: { code: "socket_unreachable", message: "secret socket path" }, code: "herdr_socket_unreachable" },
		{ capabilities: { ...capabilities, protocol: 15 }, code: "herdr_protocol_unsupported" },
		{ capabilities: { ...capabilities, fixedInterrupt: false }, code: "herdr_protocol_unsupported" },
	]) {
		const fixture = setup(extra); await expectCode(checkPreconditions(fixture.dependencies), extra.code);
		expect(fixture.clients()).toBe(1); expect(fixture.disposed()).toBe(1);
	}
	expect("agent.stop" in capabilities).toBe(false);
});

test("requires caller pane, workspace, and native Herdr Pi integration", async () => {
	for (const snapshot of [
		{ snapshot: { panes: [], agents: [] } },
		{ snapshot: { panes: [{ pane_id: "pane-1" }], agents: [] } },
		{ snapshot: { panes: [{ pane_id: "pane-1", workspace_id: "workspace-1" }], agents: [{ pane_id: "pane-1", agent_session: { source: "other", kind: "path" } }] } },
	]) {
		const fixture = setup({ snapshot }); await expectCode(checkPreconditions(fixture.dependencies), snapshot.snapshot.panes.length === 0 || !snapshot.snapshot.panes[0]?.workspace_id ? "calling_pane_not_found" : "pi_integration_missing");
		expect(fixture.disposed()).toBe(1);
	}
	const opaque = setup({ snapshot: { snapshot: { panes: [{ pane_id: "pane-1", workspace_id: "workspace-1" }], agents: [{ pane_id: "pane-1", agent_session: { source: "herdr:pi", kind: "id" } }] } } });
	await expect(checkPreconditions(opaque.dependencies)).resolves.toMatchObject({ callerPaneId: "pane-1" });
});

test("returns resolved caller context and validates parent nesting metadata through depth three", async () => {
	const root = setup();
	await expect(checkPreconditions(root.dependencies)).resolves.toEqual({ socketPath: "/runtime/herdr.sock", workspaceId: "workspace-1", callerPaneId: "pane-1", nestingDepth: 0, protocol: 16, capabilities, piExecutable: "/usr/local/bin/pi" });
	const nested = setup({ env: baseEnv({ PI_HERDR_PARENT_ROOT_RUN_ID: "root-run", PI_HERDR_NESTING_DEPTH: String(MAX_NESTING_DEPTH) }) });
	await expect(checkPreconditions(nested.dependencies)).resolves.toMatchObject({ parentRootRunId: "root-run", nestingDepth: MAX_NESTING_DEPTH });
	const legacy = setup({ env: baseEnv({ HERDR_PARENT_ROOT_RUN_ID: "legacy-root", HERDR_NESTING_DEPTH: "999" }) });
	await expect(checkPreconditions(legacy.dependencies)).resolves.toMatchObject({ nestingDepth: 0 });
	await expect(checkPreconditions(legacy.dependencies)).resolves.not.toHaveProperty("parentRootRunId");
	for (const env of [
		baseEnv({ PI_HERDR_NESTING_DEPTH: "4", PI_HERDR_PARENT_ROOT_RUN_ID: "root-run" }),
		baseEnv({ PI_HERDR_NESTING_DEPTH: "no", PI_HERDR_PARENT_ROOT_RUN_ID: "root-run" }),
		baseEnv({ PI_HERDR_NESTING_DEPTH: "1" }),
		baseEnv({ PI_HERDR_PARENT_ROOT_RUN_ID: "root-run" }),
	]) {
		const fixture = setup({ env }); await expectCode(checkPreconditions(fixture.dependencies), "nesting_depth_exceeded");
		expect(fixture.clients()).toBe(0);
	}
});

test("redacts socket failures and never tries RPC fallback or installation", async () => {
	const fixture = setup({ probeError: { code: "socket_unreachable", message: "/private/socket task body" } });
	try { await checkPreconditions(fixture.dependencies); throw new Error("expected failure"); } catch (error) {
		expect(error).toMatchObject({ code: "herdr_socket_unreachable" });
		expect((error as Error).message).not.toContain("/private/socket");
		expect((error as Error).message).not.toMatch(/rpc|install/i);
	}
});
