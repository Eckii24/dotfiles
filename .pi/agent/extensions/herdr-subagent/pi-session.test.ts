import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, open, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	PiSessionError,
	findTurnAnchor,
	harvestTurn,
	materializeAndTrustSession,
	pollForFlush,
	recordAbsentSessionBaseline,
	validatePiSessionRef,
} from "./pi-session.js";

const fixtures = join(import.meta.dir, "test-fixtures/sessions");
const marker = (turnId: string) => ` [herdr:task-sentinel:v1:${turnId}]`;

async function trusted(name: string) {
	const base = await mkdtemp(join(tmpdir(), "pi-session-"));
	const root = join(base, "sessions");
	const path = join(root, name);
	await mkdir(root); await cp(join(fixtures, name), path);
	const ref = await validatePiSessionRef({ agent_session: { source: "herdr:pi", kind: "path", value: path } }, root);
	// Baseline belongs to pre-materialization protocol; this helper creates fixture first.
	const baseline = { path: ref.path, recordedAt: 0 };
	const session = await materializeAndTrustSession(ref, baseline);
	if (session.pending) throw new Error("fixture unexpectedly pending");
	return { base, root, path, ref, session };
}

test("trusts only reported Herdr Pi paths under canonical root after ENOENT baseline", async () => {
	const base = await mkdtemp(join(tmpdir(), "pi-session-"));
	const root = join(base, "sessions"); const path = join(root, "lazy.jsonl"); await mkdir(root);
	const ref = await validatePiSessionRef({ agent_session: { source: "herdr:pi", kind: "path", value: path } }, root);
	const baseline = await recordAbsentSessionBaseline(ref);
	expect((await materializeAndTrustSession(ref, baseline)).pending).toBe(true);
	await cp(join(fixtures, "minimal-normal.jsonl"), path);
	const session = await materializeAndTrustSession(ref, baseline);
	expect(session.pending).not.toBe(true);
	await expect(validatePiSessionRef({ agent_session: { source: "other", kind: "path", value: path } }, root)).rejects.toThrow(PiSessionError);
	await expect(validatePiSessionRef({ source: "herdr:pi", kind: "path", value: join(base, "outside") }, root)).rejects.toThrow("session_path_untrusted");
	await rm(base, { recursive: true, force: true });
});

test("rejects symlink, non-regular, wrong owner, and preexisting baseline", async () => {
	const base = await mkdtemp(join(tmpdir(), "pi-session-")); const root = join(base, "sessions"); await mkdir(root);
	const link = join(root, "link.jsonl"); await symlink(join(fixtures, "minimal-normal.jsonl"), link);
	const ref = await validatePiSessionRef({ source: "herdr:pi", kind: "path", value: link }, root);
	await expect(materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 })).rejects.toThrow("session_path_untrusted");
	await expect(recordAbsentSessionBaseline(ref)).rejects.toThrow("session_path_untrusted");
	const directory = join(root, "dir.jsonl"); await mkdir(directory);
	const dirRef = await validatePiSessionRef({ source: "herdr:pi", kind: "path", value: directory }, root);
	await expect(materializeAndTrustSession(dirRef, { path: dirRef.path, recordedAt: 0 })).rejects.toThrow("session_path_untrusted");
	const fake = { lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false, uid: 999, size: 1 }), realpath: async (p: string) => p, stat: async () => ({ isFile: () => true, isSymbolicLink: () => false, uid: 999, size: 1 }) };
	await expect(materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }, { ...fake, uid: 1 })).rejects.toThrow("session_path_untrusted");
	await rm(base, { recursive: true, force: true });
});

test("trusts the opened in-root path without relying on non-portable descriptor pseudo-paths", async () => {
	const base = await mkdtemp(join(tmpdir(), "pi-session-")); const root = join(base, "sessions"); const path = join(root, "session.jsonl"); await mkdir(root);
	await cp(join(fixtures, "minimal-normal.jsonl"), path);
	const ref = await validatePiSessionRef({ source: "herdr:pi", kind: "path", value: path }, root);
	const session = await materializeAndTrustSession(ref, { path: ref.path, recordedAt: 0 }, {
		realpath: async value => value.startsWith("/proc/self/fd/") || value.startsWith("/dev/fd/") ? "/dev/fd/unresolved" : realpath(value),
	});
	expect(session.pending).not.toBe(true);
	if (!session.pending) expect(session.path).toBe(ref.path);
	await rm(base, { recursive: true, force: true });
});

test("fails closed when a session path changes before or during trusted reads", async () => {
	const value = await trusted("minimal-normal.jsonl");
	const replacement = join(value.base, "replacement.jsonl");
	await writeFile(replacement, '{"type":"session","version":3,"id":"replacement"}\n{malformed}\n');
	await rename(replacement, value.path);
	await expect(findTurnAnchor(value.session, "TURN_NORMAL")).rejects.toThrow("session_path_untrusted");
	await expect(harvestTurn(value.session, "TURN_NORMAL", { id: "anchor", parentId: "before", marker: "TURN_NORMAL" }, { state: "done" })).rejects.toThrow("session_path_untrusted");

	const duringPath = join(value.root, "during.jsonl"); const duringReplacement = join(value.base, "during-replacement.jsonl");
	await cp(join(fixtures, "minimal-normal.jsonl"), duringPath); await cp(join(fixtures, "minimal-normal.jsonl"), duringReplacement);
	const duringRef = await validatePiSessionRef({ source: "herdr:pi", kind: "path", value: duringPath }, value.root);
	await expect(materializeAndTrustSession(duringRef, { path: duringRef.path, recordedAt: 0 }, {
		open: async (target, flags) => { const handle = await open(target, flags); await rename(duringReplacement, target); return handle; },
	})).rejects.toThrow("session_path_untrusted");
	await rm(value.base, { recursive: true, force: true });
});

test("harvests exact unique anchor through tool descendants with text-only final details", async () => {
	const value = await trusted("minimal-tools.jsonl");
	const turnMarker = marker("TURN_TOOLS");
	const anchor = await findTurnAnchor(value.session, turnMarker); expect(anchor.pending).not.toBe(true);
	if (anchor.pending) throw new Error("missing anchor");
	const result = await harvestTurn(value.session, turnMarker, anchor, { state: "done" });
	expect(result).toMatchObject({ pending: false, status: "succeeded", output: "tool done", sessionId: "session-tools", anchorEntryId: "anchor", finalEntryId: "final", stopReason: "stop" });
	expect(await harvestTurn(value.session, turnMarker, anchor, { state: "working" })).toEqual({ pending: true });
	await rm(value.base, { recursive: true, force: true });
});

test("ignores guardrails decisions interleaved with a delegated tool turn", async () => {
	const value = await trusted("minimal-tools.jsonl");
	const content = await Bun.file(value.path).text();
	await writeFile(value.path, content.replace('{"type":"message","id":"result"', '{"type":"custom","customType":"guardrails-decision","id":"guardrail","parentId":"call"}\n{"type":"message","id":"result"'));
	const turnMarker = marker("TURN_TOOLS");
	const anchor = await findTurnAnchor(value.session, turnMarker); if (anchor.pending) throw new Error("missing anchor");
	expect(await harvestTurn(value.session, turnMarker, anchor, { state: "done" })).toMatchObject({ status: "succeeded", output: "tool done" });
	await rm(value.base, { recursive: true, force: true });
});

test("rejects user/custom ambiguity and branch switch; maps terminal stop reasons", async () => {
	for (const [file, turnId] of [["minimal-ambiguous.jsonl", "TURN_AMBIG"], ["minimal-branch.jsonl", "TURN_BRANCH"]] as const) {
		const turnMarker = marker(turnId); const value = await trusted(file); const anchor = await findTurnAnchor(value.session, turnMarker); if (anchor.pending) throw new Error("missing anchor");
		await expect(harvestTurn(value.session, turnMarker, anchor, { state: "idle" })).rejects.toThrow("ambiguous_turn"); await rm(value.base, { recursive: true, force: true });
	}
	const stops = await trusted("minimal-stops.jsonl"); const turnMarker = marker("TURN_STOP"); const anchor = await findTurnAnchor(stops.session, turnMarker); if (anchor.pending) throw new Error("missing anchor");
	expect(await harvestTurn(stops.session, turnMarker, anchor, { state: "done" })).toMatchObject({ status: "failed", stopReason: "length", error: { code: "result_unavailable" } });
	const stopsText = await Bun.file(stops.path).text();
	for (const [reason, code] of [["error", "child_model_error"], ["aborted", "child_aborted"]] as const) {
		await writeFile(stops.path, stopsText.replace('"stopReason":"length"', `"stopReason":"${reason}"`));
		expect(await harvestTurn(stops.session, turnMarker, anchor, { state: "done" })).toMatchObject({ status: reason === "aborted" ? "aborted" : "failed", stopReason: reason, error: { code } });
	}
	await writeFile(stops.path, stopsText.replace('"partial"', '""').replace('"stopReason":"length"', '"stopReason":"stop"'));
	await expect(harvestTurn(stops.session, turnMarker, anchor, { state: "done" })).rejects.toThrow("empty_final_output");
	await rm(stops.base, { recursive: true, force: true });
});

test("G1 retained fixture replays both native turns without screen fallback", async () => {
	const value = await trusted("g1-live-redacted.jsonl");
	for (const turnId of ["G1_FIXTURE_TURN_ONE", "G1_FIXTURE_TURN_TWO"]) {
		const turnMarker = marker(turnId); const anchor = await findTurnAnchor(value.session, turnMarker); if (anchor.pending) throw new Error("missing G1 anchor");
		expect(await harvestTurn(value.session, turnMarker, anchor, { state: "done" })).toMatchObject({ status: "succeeded", stopReason: "stop" });
	}
	await rm(value.base, { recursive: true, force: true });
});

test("anchors only one terminal marker and revalidates it during harvest", async () => {
	const value = await trusted("minimal-normal.jsonl"); const content = await Bun.file(value.path).text(); const turnMarker = marker("TURN_NORMAL");
	for (const replacement of [`do work${turnMarker} trailing`, `do work${turnMarker}${turnMarker}`]) {
		await writeFile(value.path, content.replace(`do work${turnMarker}`, replacement));
		expect(await findTurnAnchor(value.session, turnMarker)).toEqual({ pending: true });
	}
	await writeFile(value.path, content);
	const anchor = await findTurnAnchor(value.session, turnMarker); if (anchor.pending) throw new Error("missing anchor");
	await writeFile(value.path, content.replace(`do work${turnMarker}`, `do work${turnMarker} trailing`));
	await expect(harvestTurn(value.session, turnMarker, anchor, { state: "done" })).rejects.toThrow("task_anchor_missing");
	await rm(value.base, { recursive: true, force: true });
});

test("partial trailing JSONL is pending; complete malformed JSONL, bad v3, duplicate marker, empty text, and bounds fail", async () => {
	const value = await trusted("minimal-normal.jsonl");
	const content = await Bun.file(value.path).text();
	await writeFile(value.path, `${content.slice(0, content.indexOf('{"type":"message","id":"final"'))}{"type":"message"`);
	const turnMarker = marker("TURN_NORMAL");
	expect((await findTurnAnchor(value.session, turnMarker)).pending).not.toBe(true);
	const anchor = await findTurnAnchor(value.session, turnMarker); if (anchor.pending) throw new Error("missing anchor");
	expect(await harvestTurn(value.session, turnMarker, anchor, { state: "idle" })).toEqual({ pending: true });
	await writeFile(value.path, `${content}{bad}\n`);
	await expect(findTurnAnchor(value.session, turnMarker)).rejects.toThrow("session_parse_failed");
	await writeFile(value.path, content.replace('"version":3', '"version":2'));
	await expect(materializeAndTrustSession(value.ref, { path: value.ref.path, recordedAt: 0 })).rejects.toThrow("session_parse_failed");
	await writeFile(value.path, content.replace('"stop"}}\n', `"stop"}}\n{"type":"message","id":"dupe","parentId":"before","message":{"role":"user","content":"duplicate${turnMarker}"}}\n`));
	await expect(findTurnAnchor(value.session, turnMarker)).rejects.toThrow("ambiguous_turn");
	await expect(findTurnAnchor(value.session, turnMarker, { maxBytes: 8 })).rejects.toThrow("session_parse_failed");
	await rm(value.base, { recursive: true, force: true });
});

test("poll helper bounds delayed flush with injected clock and sleeper", async () => {
	let now = 0; let probes = 0;
	const result = await pollForFlush(async () => ++probes < 3 ? { pending: true } : "final", { clock: { now: () => now }, sleeper: { sleep: async ms => { now += ms; } }, timeoutMs: 10, intervalMs: 4 });
	expect(result).toBe("final"); expect(probes).toBe(3);
	const timeout = await pollForFlush(async () => ({ pending: true }), { clock: { now: () => now }, sleeper: { sleep: async ms => { now += ms; } }, timeoutMs: 3, intervalMs: 2 });
	expect(timeout).toEqual({ pending: true });
});
