import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type { ErrorCode } from "./contracts.js";

export const MAX_SESSION_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_LINE_BYTES = 256 * 1024;

export type PiSessionRef = { source: "herdr:pi"; kind: "path"; path: string; root: string };
export type SessionBaseline = { path: string; recordedAt: number };
export type TrustedMaterializedSession = PiSessionRef & { sessionId: string; bytes: number; identity: FileIdentity };
export type Pending = { pending: true };
export type TurnAnchor = { id: string; parentId: string | null; marker: string };
export type CandidateSettlement = "idle" | "done";
export type SessionUsage = Record<string, unknown>;
export type HarvestResult = {
	pending: false;
	status: "succeeded" | "failed" | "aborted";
	output?: string;
	stopReason: "stop" | "length" | "error" | "aborted";
	sessionId: string;
	anchorEntryId: string;
	finalEntryId: string;
	provider?: string;
	model?: string;
	usage?: SessionUsage;
	error?: { code: ErrorCode; message: string };
};

type FileIdentity = { dev: number; ino: number };
type FileInfo = { isFile(): boolean; isSymbolicLink(): boolean; uid: number; size?: number; dev?: number; ino?: number };
type OpenedSessionFile = { fd: number; stat(): Promise<FileInfo>; read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number }>; close(): Promise<void> };
type SessionDependencies = {
	uid?: number;
	now?: () => number;
	lstat?: (path: string) => Promise<FileInfo>;
	realpath?: (path: string) => Promise<string>;
	open?: (path: string, flags: string) => Promise<OpenedSessionFile>;
	maxBytes?: number;
	maxLineBytes?: number;
};
type SessionEntry = { type: string; id: string; parentId: string | null; customType?: string; message?: Record<string, unknown> };
type ParsedSession = { header: { id: string }; entries: SessionEntry[] };

export class PiSessionError extends Error {
	constructor(readonly code: Extract<ErrorCode, "session_reference_missing" | "session_path_untrusted" | "session_parse_failed" | "task_anchor_missing" | "ambiguous_turn" | "empty_final_output" | "result_unavailable" | "child_model_error" | "child_aborted">, message: string) {
		super(`${code}: ${message}`);
		this.name = "PiSessionError";
	}
}

/** Accepts only Herdr's Pi path reference with canonical parent constrained by canonical session root. */
export async function validatePiSessionRef(agentInfo: unknown, configuredRoot: string, dependencies: SessionDependencies = {}): Promise<PiSessionRef> {
	const agent = object(agentInfo);
	const reported = object(agent?.agent_session) ?? object(agentInfo);
	if (reported?.source !== "herdr:pi" || reported.kind !== "path" || typeof reported.value !== "string" || !reported.value) {
		fail("session_reference_missing", "Herdr did not report a Pi path session reference.");
	}
	if (!isAbsolute(reported.value) || !isAbsolute(configuredRoot)) fail("session_path_untrusted", "Pi session path and root must be absolute.");
	const io = fs(dependencies);
	const canonicalRoot = await io.realpath(configuredRoot).catch(() => fail("session_path_untrusted", "Pi session root is unavailable."));
	const reportedPath = resolve(reported.value);
	const canonicalParent = await io.realpath(dirname(reportedPath)).catch(() => fail("session_path_untrusted", "Pi session parent directory is unavailable."));
	const path = resolve(canonicalParent, basename(reportedPath));
	if (!inside(canonicalRoot, path)) fail("session_path_untrusted", "Reported Pi session path is outside configured session root.");
	return { source: "herdr:pi", kind: "path", path, root: canonicalRoot };
}

/** Records required ENOENT state. No session bytes are read before materialization. */
export async function recordAbsentSessionBaseline(ref: PiSessionRef, dependencies: SessionDependencies = {}): Promise<SessionBaseline> {
	try { await fs(dependencies).lstat(ref.path); }
	catch (error) {
		if (code(error) === "ENOENT") return { path: ref.path, recordedAt: (dependencies.now ?? Date.now)() };
		throw error;
	}
	fail("session_path_untrusted", "Reported Pi session file existed before required absent-file baseline.");
}

/** Returns pending until lazy session file exists, then validates it before any read. */
export async function materializeAndTrustSession(ref: PiSessionRef, baseline: SessionBaseline, dependencies: SessionDependencies = {}): Promise<TrustedMaterializedSession | Pending> {
	if (baseline.path !== ref.path) fail("session_path_untrusted", "Session baseline does not match reported path.");
	const trusted = await readTrustedSession(ref, dependencies, undefined, true);
	if (isPending(trusted)) return trusted;
	if (isPending(trusted.parsed)) return { pending: true };
	return { ...ref, path: trusted.path, sessionId: trusted.parsed.header.id, bytes: trusted.bytes, identity: trusted.identity };
}

export async function findTurnAnchor(ref: TrustedMaterializedSession, marker: string, dependencies: SessionDependencies = {}): Promise<TurnAnchor | Pending> {
	const parsed = await parseFile(ref, dependencies);
	if (isPending(parsed)) return { pending: true };
	const anchors = parsed.entries.filter(entry => entry.type === "message" && entry.message?.role === "user" && terminalSingleton(messageText(entry.message.content), marker));
	if (anchors.length === 0) return { pending: true };
	if (anchors.length !== 1) fail("ambiguous_turn", "Turn marker appears in multiple user entries.");
	const anchor = anchors[0]!;
	return { id: anchor.id, parentId: anchor.parentId, marker };
}

/** Harvests only after idle/done candidate settlement; lifecycle state itself never succeeds. */
export async function harvestTurn(ref: TrustedMaterializedSession, marker: string, anchor: TurnAnchor, lifecycle: { state?: string }, dependencies: SessionDependencies = {}): Promise<HarvestResult | Pending> {
	if (lifecycle.state !== "idle" && lifecycle.state !== "done") return { pending: true };
	const parsed = await parseFile(ref, dependencies);
	if (isPending(parsed)) return { pending: true };
	const byId = new Map(parsed.entries.map(entry => [entry.id, entry]));
	const storedAnchor = byId.get(anchor.id);
	if (!storedAnchor || storedAnchor.type !== "message" || storedAnchor.message?.role !== "user" || anchor.marker !== marker || !terminalSingleton(messageText(storedAnchor.message.content), marker)) fail("task_anchor_missing", "Recorded turn anchor is absent or changed.");
	const anchorIndex = parsed.entries.indexOf(storedAnchor);
	const afterAnchor = parsed.entries.slice(anchorIndex + 1);
	const interruption = afterAnchor.findIndex(entry => (entry.type === "custom" && entry.customType !== "guardrails-decision") || entry.type === "custom_message" || entry.message?.role === "user");
	const turnEntries = interruption < 0 ? afterAnchor : afterAnchor.slice(0, interruption);
	const assistants = turnEntries.filter(entry => entry.type === "message" && entry.message?.role === "assistant" && descendant(entry, storedAnchor.id, byId));
	const final = assistants.filter(entry => stopReason(entry.message) !== "toolUse").at(-1);
	if (!final) {
		if (interruption >= 0) fail("ambiguous_turn", "User or custom input interleaved with the delegated turn.");
		return { pending: true };
	}
	const reason = stopReason(final.message);
	if (!reason) fail("session_parse_failed", "Final assistant entry has invalid stop reason.");
	const details = { pending: false as const, sessionId: ref.sessionId, anchorEntryId: anchor.id, finalEntryId: final.id, provider: optionalText(final.message?.provider), model: optionalText(final.message?.model), usage: object(final.message?.usage) };
	if (reason === "error") return { ...details, status: "failed", stopReason: reason, error: { code: "child_model_error", message: optionalText(final.message?.errorMessage) ?? "Pi model returned an error." } };
	if (reason === "aborted") return { ...details, status: "aborted", stopReason: reason, error: { code: "child_aborted", message: "Pi turn was aborted." } };
	if (reason === "length") return { ...details, status: "failed", stopReason: reason, error: { code: "result_unavailable", message: "Pi response stopped at length limit." } };
	const output = textBlocks(final.message?.content);
	if (!output.trim()) fail("empty_final_output", "Final Pi assistant response has no text blocks.");
	return { ...details, status: "succeeded", stopReason: "stop", output };
}

export type Clock = { now(): number };
export type Sleeper = { sleep(ms: number): Promise<void> };
/** Bounded delayed-flush poll primitive. Inject clock/sleeper for deterministic lifecycle tests. */
export async function pollForFlush<T>(probe: () => Promise<T | Pending>, options: { clock: Clock; sleeper: Sleeper; timeoutMs: number; intervalMs: number }): Promise<T | Pending> {
	const deadline = options.clock.now() + options.timeoutMs;
	for (;;) {
		const value = await probe();
		if (!(isPending(value))) return value;
		if (options.clock.now() >= deadline) return { pending: true };
		await options.sleeper.sleep(Math.min(options.intervalMs, deadline - options.clock.now()));
	}
}

async function parseFile(ref: TrustedMaterializedSession, dependencies: SessionDependencies): Promise<ParsedSession | Pending> {
	const trusted = await readTrustedSession(ref, dependencies, ref.identity);
	return isPending(trusted) ? trusted : trusted.parsed;
}

/** Validates path and opened descriptor identity, then bounds, reads, and parses that descriptor. */
async function readTrustedSession(ref: PiSessionRef, dependencies: SessionDependencies, expected: FileIdentity | undefined, absentIsPending = false): Promise<{ path: string; identity: FileIdentity; bytes: number; parsed: ParsedSession | Pending } | Pending> {
	const io = fs(dependencies);
	let link: FileInfo;
	try { link = await io.lstat(ref.path); }
	catch (error) {
		if (absentIsPending && code(error) === "ENOENT") return { pending: true };
		fail("session_path_untrusted", "Pi session path disappeared during trust validation.");
	}
	const uid = dependencies.uid ?? process.getuid?.();
	if (link.isSymbolicLink() || !link.isFile() || (uid !== undefined && link.uid !== uid)) fail("session_path_untrusted", "Pi session file is not a current-user regular non-symlink file.");
	const linkIdentity = identity(link);
	let handle: OpenedSessionFile;
	try { handle = await io.open(ref.path, "r"); }
	catch (error) {
		if (absentIsPending && code(error) === "ENOENT") return { pending: true };
		fail("session_path_untrusted", "Pi session path disappeared during trust validation.");
	}
	try {
		const info = await handle.stat();
		const openedIdentity = identity(info);
		if (!info.isFile() || (uid !== undefined && info.uid !== uid) || !sameIdentity(linkIdentity, openedIdentity) || (expected && !sameIdentity(expected, openedIdentity))) fail("session_path_untrusted", "Opened Pi session file is untrusted or was replaced.");
		// Descriptor pseudo-paths are not portable: macOS may expose /dev/fd/<n>
		// instead of the opened pathname. Revalidate the canonical pathname and
		// require it to still identify this descriptor before reading from it.
		const currentPath = await io.realpath(ref.path).catch(() => fail("session_path_untrusted", "Pi session path cannot be canonicalized after opening."));
		if (currentPath !== ref.path || !inside(ref.root, currentPath)) fail("session_path_untrusted", "Opened Pi session file escaped configured root.");
		const currentLink = await io.lstat(ref.path).catch(() => fail("session_path_untrusted", "Pi session path disappeared during trust validation."));
		if (currentLink.isSymbolicLink() || !currentLink.isFile() || (uid !== undefined && currentLink.uid !== uid) || !sameIdentity(identity(currentLink), openedIdentity)) fail("session_path_untrusted", "Opened Pi session path changed during trust validation.");
		const bytes = await readBounded(handle, dependencies.maxBytes ?? MAX_SESSION_BYTES, info.size);
		return { path: currentPath, identity: openedIdentity, bytes: bytes.byteLength, parsed: parseBytes(bytes, dependencies) };
	} finally { await handle.close(); }
}

async function readBounded(handle: OpenedSessionFile, maxBytes: number, declaredSize: number | undefined): Promise<Buffer> {
	if (declaredSize !== undefined && declaredSize > maxBytes) fail("session_parse_failed", "Pi session exceeds byte limit.");
	const bytes = Buffer.allocUnsafe(maxBytes + 1);
	let offset = 0;
	while (offset <= maxBytes) {
		const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, null);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	if (offset > maxBytes) fail("session_parse_failed", "Pi session exceeds byte limit.");
	return bytes.subarray(0, offset);
}
function parseBytes(bytes: Buffer, dependencies: SessionDependencies): ParsedSession | Pending {
	if (bytes.byteLength > (dependencies.maxBytes ?? MAX_SESSION_BYTES)) fail("session_parse_failed", "Pi session exceeds byte limit.");
	const lines = bytes.toString("utf8").split("\n");
	const complete = bytes.byteLength === 0 || bytes.at(-1) === 0x0a;
	if (!complete) lines.pop();
	if (lines.length && lines.at(-1) === "") lines.pop();
	if (!complete && lines.length === 0) return { pending: true };
	const values: unknown[] = [];
	for (const line of lines) {
		if (!line) fail("session_parse_failed", "Pi session contains an empty complete line.");
		if (Buffer.byteLength(line) > (dependencies.maxLineBytes ?? MAX_SESSION_LINE_BYTES)) fail("session_parse_failed", "Pi session line exceeds byte limit.");
		try { values.push(JSON.parse(line)); } catch { fail("session_parse_failed", "Pi session contains malformed complete JSONL."); }
	}
	const header = object(values[0]);
	if (!header || header.type !== "session" || header.version !== 3 || typeof header.id !== "string" || !header.id) fail("session_parse_failed", "Pi session requires a v3 header.");
	const entries: SessionEntry[] = [];
	for (const raw of values.slice(1)) {
		const entry = object(raw);
		if (!entry || typeof entry.type !== "string" || typeof entry.id !== "string" || !entry.id || !(typeof entry.parentId === "string" || entry.parentId === null)) fail("session_parse_failed", "Pi session entry is malformed.");
		if (entry.type === "message" && !object(entry.message)) fail("session_parse_failed", "Pi message entry is malformed.");
		entries.push({ type: entry.type, id: entry.id, parentId: entry.parentId as string | null, customType: typeof entry.customType === "string" ? entry.customType : undefined, message: object(entry.message) });
	}
	return { header: { id: header.id }, entries };
}

function fs(deps: SessionDependencies) { return { lstat: deps.lstat ?? lstat, realpath: deps.realpath ?? realpath, open: deps.open ?? open }; }
function identity(info: FileInfo): FileIdentity { if (typeof info.dev !== "number" || typeof info.ino !== "number") fail("session_path_untrusted", "Pi session file identity is unavailable."); return { dev: info.dev, ino: info.ino }; }
function sameIdentity(left: FileIdentity, right: FileIdentity): boolean { return left.dev === right.dev && left.ino === right.ino; }
function object(value: unknown): Record<string, any> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, any> : undefined; }
function optionalText(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function messageText(content: unknown): string { return typeof content === "string" ? content : textBlocks(content); }
function textBlocks(content: unknown): string { return Array.isArray(content) ? content.filter(block => object(block)?.type === "text" && typeof object(block)?.text === "string").map(block => object(block)!.text as string).join("") : ""; }
function terminalSingleton(text: string, marker: string): boolean { return !!marker && text.endsWith(marker) && markerCount(text, marker) === 1; }
function markerCount(text: string, marker: string): number { let count = 0; for (let at = text.indexOf(marker); at >= 0; at = text.indexOf(marker, at + marker.length)) count++; return count; }
function stopReason(message: Record<string, unknown> | undefined): "stop" | "length" | "toolUse" | "error" | "aborted" | undefined { const value = message?.stopReason; return value === "stop" || value === "length" || value === "toolUse" || value === "error" || value === "aborted" ? value : undefined; }
function descendant(entry: SessionEntry, ancestorId: string, byId: Map<string, SessionEntry>): boolean { for (let id = entry.parentId; id; id = byId.get(id)?.parentId ?? null) if (id === ancestorId) return true; return false; }
function inside(root: string, path: string): boolean { const delta = relative(root, path); return delta !== "" && !delta.startsWith("..") && !isAbsolute(delta); }
function isPending(value: unknown): value is Pending { return object(value)?.pending === true; }
function code(error: unknown): string | undefined { return object(error)?.code; }
function fail(code: PiSessionError["code"], message: string): never { throw new PiSessionError(code, message); }
