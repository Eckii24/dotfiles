import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { AgentProfile } from "./agent-profiles.js";
import { PreconditionsError, MAX_NESTING_DEPTH } from "./preconditions.js";

export const PI_HERDR_ROOT_RUN_ID = "PI_HERDR_ROOT_RUN_ID";
export const PI_HERDR_LEAF_RUN_ID = "PI_HERDR_LEAF_RUN_ID";
export const PI_HERDR_PARENT_ROOT_RUN_ID = "PI_HERDR_PARENT_ROOT_RUN_ID";
export const PI_HERDR_NESTING_DEPTH = "PI_HERDR_NESTING_DEPTH";
export const PI_HERDR_GROUP = "PI_HERDR_GROUP";
export const PI_HERDR_AGENT_PROFILE = "PI_HERDR_AGENT_PROFILE";
export const PI_HERDR_SUBAGENT_CHILD = "PI_HERDR_SUBAGENT_CHILD";
/** Standard marker consumed by child-aware global extensions such as dirty-repo-guard. */
export const PI_SUBAGENT = "PI_SUBAGENT";

export type PiLaunchInput = {
	piExecutable: string;
	cwd: string;
	profile: Pick<AgentProfile, "name" | "model" | "tools" | "systemPrompt">;
	rootRunId: string;
	leafRunId: string;
	parentRootRunId?: string;
	nestingDepth: number;
	group: string;
};

export type PiLaunchDescriptor = {
	executable: string;
	argv: string[];
	cwd: string;
	env: Record<string, string>;
	name: string;
	promptFilePath: string;
	cleanupAfterReady(): Promise<void>;
	cleanupAfterFailure(): Promise<void>;
	/** Safe for diagnostics: no profile body, task, or inherited environment. */
	log: { executable: string; argv: string[]; cwd: string; envNames: string[]; name: string };
};

type FileInfo = { isDirectory(): boolean; isSymbolicLink(): boolean; uid: number };
type LaunchDependencies = {
	env?: Readonly<Record<string, string | undefined>>;
	uid?: number;
	lstat?: (path: string) => Promise<FileInfo>;
	realpath?: (path: string) => Promise<string>;
	access?: (path: string, mode?: number) => Promise<void>;
	mkdir?: (path: string, options?: { recursive?: boolean; mode?: number }) => Promise<string | undefined>;
	chmod?: (path: string, mode: number) => Promise<void>;
	mkdtemp?: (prefix: string) => Promise<string>;
	open?: typeof open;
	rm?: (path: string, options?: { force?: boolean; recursive?: boolean }) => Promise<void>;
	runtimeRoot?: string;
};

/** Builds an interactive persisted Pi child. Caller invokes cleanup only on failure or stable readiness. */
export async function createPiLaunchDescriptor(input: PiLaunchInput, dependencies: LaunchDependencies = {}): Promise<PiLaunchDescriptor> {
	const executable = await resolveExecutable(input.piExecutable, dependencies);
	const cwd = await canonicalDirectory(input.cwd, dependencies);
	const childDepth = input.nestingDepth + 1;
	if (!Number.isInteger(input.nestingDepth) || input.nestingDepth < 0 || childDepth > MAX_NESTING_DEPTH) {
		throw new PreconditionsError("nesting_depth_exceeded", `Pi child nesting may not exceed ${MAX_NESTING_DEPTH}.`);
	}
	const runtimeDir = await createRuntimeDir(dependencies);
	const promptFilePath = join(runtimeDir, "prompt.md");
	await writePrompt(promptFilePath, input.profile.systemPrompt, dependencies);
	let cleaned = false;
	const cleanup = async () => {
		if (cleaned) return;
		cleaned = true;
		await (dependencies.rm ?? rm)(runtimeDir, { recursive: true, force: true });
	};
	const name = launchName(input.group, input.profile.name, input.leafRunId);
	const argv = [
		"--name", name,
		...(input.profile.model ? ["--model", input.profile.model] : []),
		...(input.profile.tools ? ["--tools", input.profile.tools.join(",")] : []),
		"--append-system-prompt", promptFilePath,
	];
	const env: Record<string, string> = {
		[PI_HERDR_ROOT_RUN_ID]: requiredId(input.rootRunId, "rootRunId"),
		[PI_HERDR_LEAF_RUN_ID]: requiredId(input.leafRunId, "leafRunId"),
		[PI_HERDR_NESTING_DEPTH]: String(childDepth),
		[PI_HERDR_GROUP]: requiredLabel(input.group, "group"),
		[PI_HERDR_AGENT_PROFILE]: requiredLabel(input.profile.name, "profile name"),
		[PI_HERDR_SUBAGENT_CHILD]: "1",
		[PI_SUBAGENT]: "1",
	};
	// Every Pi child becomes a potential nested caller; its parent is this launched root,
	// not this root's parent (which would skip one ownership level).
	env[PI_HERDR_PARENT_ROOT_RUN_ID] = requiredId(input.rootRunId, "rootRunId");
	// Nested coordinators must share the caller's capacity runtime directory.
	const inheritedRuntime = (dependencies.env ?? process.env).XDG_RUNTIME_DIR;
	if (inheritedRuntime && isAbsolute(inheritedRuntime)) env.XDG_RUNTIME_DIR = inheritedRuntime;
	return {
		executable, argv, cwd, env, name, promptFilePath,
		cleanupAfterReady: cleanup, cleanupAfterFailure: cleanup,
		log: { executable, argv: [...argv], cwd, envNames: Object.keys(env).sort(), name },
	};
}

async function resolveExecutable(path: string, dependencies: LaunchDependencies): Promise<string> {
	if (!isAbsolute(path)) throw new PreconditionsError("pi_integration_missing", "Pi executable must be an absolute executable path.");
	try { await (dependencies.access ?? access)(path, constants.X_OK); } catch { throw new PreconditionsError("pi_integration_missing", "Pi executable is not executable."); }
	return path;
}

async function canonicalDirectory(path: string, dependencies: LaunchDependencies): Promise<string> {
	if (!isAbsolute(path)) throw new PreconditionsError("invalid_execution_mode", "cwd must be an absolute existing directory.");
	let canonical: string;
	try { canonical = await (dependencies.realpath ?? realpath)(path); } catch { throw new PreconditionsError("invalid_execution_mode", "cwd must be an existing directory."); }
	try {
		const info = await (dependencies.lstat ?? lstat)(canonical);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("not directory");
	} catch { throw new PreconditionsError("invalid_execution_mode", "cwd must resolve to an existing directory."); }
	return canonical;
}

async function createRuntimeDir(dependencies: LaunchDependencies): Promise<string> {
	const uid = dependencies.uid ?? process.getuid?.();
	const root = dependencies.runtimeRoot ?? (dependencies.env ?? process.env).XDG_RUNTIME_DIR ?? tmpdir();
	const base = join(root, `pi-herdr-subagent-${uid ?? "user"}`);
	try {
		await (dependencies.mkdir ?? mkdir)(base, { recursive: true, mode: 0o700 });
		await (dependencies.chmod ?? chmod)(base, 0o700);
		const info = await (dependencies.lstat ?? lstat)(base);
		if (!info.isDirectory() || info.isSymbolicLink() || (uid !== undefined && info.uid !== uid)) throw new Error("untrusted runtime directory");
	} catch {
		throw new PreconditionsError("pi_integration_missing", "Cannot create a current-user Pi Herdr runtime directory.");
	}
	return (dependencies.mkdtemp ?? mkdtemp)(join(base, "launch-"));
}

async function writePrompt(path: string, body: string, dependencies: LaunchDependencies) {
	const handle = await (dependencies.open ?? open)(path, "wx", 0o600);
	try { await handle.writeFile(body, "utf8"); await handle.chmod(0o600); }
	finally { await handle.close(); }
}

function launchName(group: string, profile: string, leafRunId: string): string {
	return `${requiredLabel(group, "group")} · ${requiredLabel(profile, "profile name")} · ${requiredId(leafRunId, "leafRunId").slice(0, 8)}`.replace(/[\p{C}]/gu, "").slice(0, 120);
}
function requiredId(value: string, field: string): string {
	if (typeof value !== "string" || !value || /[\p{C}]/u.test(value)) throw new PreconditionsError("invalid_execution_mode", `${field} is invalid.`);
	return value;
}
function requiredLabel(value: string, field: string): string {
	if (typeof value !== "string" || !value.trim() || /[\p{C}]/u.test(value)) throw new PreconditionsError("invalid_execution_mode", `${field} is invalid.`);
	return value.trim();
}
