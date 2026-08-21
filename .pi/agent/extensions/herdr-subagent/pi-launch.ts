import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { AgentProfile } from "./agent-profiles.js";
import { parseInheritedSessionPreflightRules } from "../guardrails/session-preflight-rules.js";
import { PI_GUARDRAILS_DISABLED, PI_GUARDRAILS_PREFLIGHT_DISABLED, PI_GUARDRAILS_PREFLIGHT_RULES } from "../shared/guardrails-session-state.ts";
import { PI_QUALITY_GATE_ATTEMPTS, PI_QUALITY_GATE_DISABLED, PI_QUALITY_GATE_TASK } from "../shared/quality-gate-session-state.ts";
import { PreconditionsError, MAX_NESTING_DEPTH } from "./preconditions.js";

export const PI_HERDR_ROOT_RUN_ID = "PI_HERDR_ROOT_RUN_ID";
export const PI_HERDR_LEAF_RUN_ID = "PI_HERDR_LEAF_RUN_ID";
export const PI_HERDR_PARENT_ROOT_RUN_ID = "PI_HERDR_PARENT_ROOT_RUN_ID";
export const PI_HERDR_NESTING_DEPTH = "PI_HERDR_NESTING_DEPTH";
export const PI_HERDR_GROUP = "PI_HERDR_GROUP";
export const PI_HERDR_AGENT_PROFILE = "PI_HERDR_AGENT_PROFILE";
/** JSON array of profile names authorized as immediate nested children. */
export const PI_HERDR_ALLOWED_CHILDREN = "PI_HERDR_ALLOWED_CHILDREN";
export const PI_HERDR_SUBAGENT_CHILD = "PI_HERDR_SUBAGENT_CHILD";
/** Standard marker consumed by child-aware global extensions such as dirty-repo-guard. */
export const PI_SUBAGENT = "PI_SUBAGENT";
export const PI_SANDBOX = "PI_SANDBOX";
export const PI_SANDBOX_SESSION_POLICY = "PI_SANDBOX_SESSION_POLICY_V1";
export const MAX_SANDBOX_SESSION_POLICY_BYTES = 64 * 1024;

export type PiLaunchInput = {
	piExecutable: string;
	cwd: string;
	profile: Pick<AgentProfile, "name" | "model" | "thinking" | "tools" | "allowedChildren" | "systemPrompt">;
	/** Effective caller runtime. Profile fields override these inherited values independently. */
	parentRuntime?: { model?: string; thinking?: ExtensionContext["thinkingLevel"]; tools?: string[] };
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
	/** Parent Pi command line. Injectable so inherited extension flags remain testable. */
	argv?: readonly string[];
};

/** Builds an interactive persisted Pi child. Caller invokes cleanup only on failure or stable readiness. */
export async function createPiLaunchDescriptor(input: PiLaunchInput, dependencies: LaunchDependencies = {}): Promise<PiLaunchDescriptor> {
	const executable = await resolveExecutable(input.piExecutable, dependencies);
	const cwd = await canonicalDirectory(input.cwd, dependencies);
	const inheritedEnv = dependencies.env ?? process.env;
	const inheritedSessionPolicy = inheritedEnv.PI_SANDBOX === "gondolin" ? inheritedEnv[PI_SANDBOX_SESSION_POLICY] : undefined;
	if (inheritedSessionPolicy !== undefined) assertSandboxSessionPolicy(inheritedSessionPolicy);
	const inheritedPreflightRules = inheritedEnv[PI_GUARDRAILS_PREFLIGHT_RULES];
	if (inheritedPreflightRules !== undefined) {
		try {
			parseInheritedSessionPreflightRules(inheritedPreflightRules);
		} catch (error) {
			throw new PreconditionsError("invalid_execution_mode", error instanceof Error ? error.message : "Invalid inherited session preflight rules.");
		}
	}
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
	const parentArgv = dependencies.argv ?? process.argv;
	const model = input.profile.model ?? input.parentRuntime?.model;
	const thinking = input.profile.thinking ?? input.parentRuntime?.thinking;
	const tools = input.profile.tools ?? input.parentRuntime?.tools;
	const qualityStateSynced = inheritedEnv[PI_QUALITY_GATE_DISABLED] === "0" || inheritedEnv[PI_QUALITY_GATE_DISABLED] === "1";
	const qualityTask = qualityStateSynced ? inheritedEnv[PI_QUALITY_GATE_TASK] : stringFlag(parentArgv, "quality-gate-task");
	const qualityAttempts = qualityStateSynced ? inheritedEnv[PI_QUALITY_GATE_ATTEMPTS] : stringFlag(parentArgv, "quality-gate-attempts");
	const argv = [
		"--name", name,
		...(model ? ["--model", model] : []),
		...(thinking ? ["--thinking", thinking] : []),
		...(tools === undefined ? [] : tools.length > 0 ? ["--tools", tools.join(",")] : ["--no-tools"]),
		// These are Guardrails extension flags, not environment state. Forward only
		// explicit enabled parent flags; children otherwise retain their own defaults.
		...(effectiveDisabled(inheritedEnv[PI_GUARDRAILS_DISABLED], parentArgv, "no-guardrails") ? ["--no-guardrails"] : []),
		...(effectiveDisabled(inheritedEnv[PI_GUARDRAILS_PREFLIGHT_DISABLED], parentArgv, "no-preflight-guardrails") ? ["--no-preflight-guardrails"] : []),
		...(effectiveDisabled(inheritedEnv[PI_QUALITY_GATE_DISABLED], parentArgv, "no-quality-gate") ? ["--no-quality-gate"] : []),
		...(qualityTask ? ["--quality-gate-task", qualityTask] : []),
		...(qualityAttempts && /^\d+$/.test(qualityAttempts) ? ["--quality-gate-attempts", qualityAttempts] : []),
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
		...(inheritedEnv.RTK_DISABLED === "1" ? { RTK_DISABLED: "1" } : {}),
		...(inheritedPreflightRules
			? { [PI_GUARDRAILS_PREFLIGHT_RULES]: inheritedPreflightRules }
			: {}),
	};
	if (input.profile.allowedChildren) env[PI_HERDR_ALLOWED_CHILDREN] = JSON.stringify(input.profile.allowedChildren);
	// Every Pi child becomes a potential nested caller; its parent is this launched root,
	// not this root's parent (which would skip one ownership level).
	env[PI_HERDR_PARENT_ROOT_RUN_ID] = requiredId(input.rootRunId, "rootRunId");
	if (inheritedEnv.PI_SANDBOX === "gondolin") {
		env[PI_SANDBOX] = "gondolin";
		if (inheritedSessionPolicy !== undefined) env[PI_SANDBOX_SESSION_POLICY] = inheritedSessionPolicy;
	}
	// Nested coordinators must share the caller's capacity runtime directory.
	const inheritedRuntime = inheritedEnv.XDG_RUNTIME_DIR;
	if (inheritedRuntime && isAbsolute(inheritedRuntime)) env.XDG_RUNTIME_DIR = inheritedRuntime;
	return {
		executable, argv, cwd, env, name, promptFilePath,
		cleanupAfterReady: cleanup, cleanupAfterFailure: cleanup,
		log: { executable, argv: [...argv], cwd, envNames: Object.keys(env).sort(), name },
	};
}

function hasEnabledBooleanFlag(argv: readonly string[], name: string): boolean {
	const exact = `--${name}`;
	const assignment = `${exact}=`;
	for (const argument of argv) {
		// Match Pi 0.84 extension-flag parsing exactly: assigned boolean values
		// still enable the flag, and `--` is not a terminator for unknown flags.
		if (argument === exact || argument.startsWith(assignment)) return true;
	}
	return false;
}

function effectiveDisabled(marker: string | undefined, argv: readonly string[], flag: string): boolean {
	return marker === "0" || marker === "1" ? marker === "1" : hasEnabledBooleanFlag(argv, flag);
}

function stringFlag(argv: readonly string[], name: string): string | undefined {
	const exact = `--${name}`;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]!;
		if (argument === "--") return undefined;
		if (argument === exact) {
			const value = argv[index + 1];
			return value && value !== "--" && !value.startsWith("--") ? value : undefined;
		}
		if (argument.startsWith(`${exact}=`)) return argument.slice(exact.length + 1) || undefined;
	}
	return undefined;
}

function assertSandboxSessionPolicy(raw: string) {
	if (Buffer.byteLength(raw, "utf8") > MAX_SANDBOX_SESSION_POLICY_BYTES) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin session policy exceeds 64KB.");
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin session policy is invalid JSON."); }
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin session policy must be an object.");
	const policy = parsed as Record<string, unknown>; const policyKeys = new Set(["mounts", "network"]);
	if (Object.keys(policy).some(key => !policyKeys.has(key))) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin session policy contains unsupported fields.");
	if (policy.mounts !== undefined) {
		if (!policy.mounts || typeof policy.mounts !== "object" || Array.isArray(policy.mounts)) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin mounts must be an object.");
		const mounts = policy.mounts as Record<string, unknown>; const mountKeys = new Set(["readOnly", "readWrite"]);
		if (Object.keys(mounts).some(key => !mountKeys.has(key))) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin mounts contain unsupported fields.");
		for (const key of mountKeys) if (mounts[key] !== undefined) {
			if (!Array.isArray(mounts[key])) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin mount lists must be arrays.");
			for (const rawMount of mounts[key]) {
				if (!rawMount || typeof rawMount !== "object" || Array.isArray(rawMount)) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin mount entry must be an object.");
				const mount = rawMount as Record<string, unknown>; const entryKeys = new Set(["hostPath", "guestPath", "required"]);
				if (Object.keys(mount).some(field => !entryKeys.has(field)) || typeof mount.hostPath !== "string" || typeof mount.guestPath !== "string" || !isAbsolute(mount.hostPath) || !isAbsolute(mount.guestPath) || (mount.required !== undefined && typeof mount.required !== "boolean")) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin mount entry is invalid.");
			}
		}
	}
	if (policy.network !== undefined) {
		if (!policy.network || typeof policy.network !== "object" || Array.isArray(policy.network)) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin network policy must be an object.");
		const network = policy.network as Record<string, unknown>; const networkKeys = new Set(["allow", "deny"]);
		if (Object.keys(network).some(key => !networkKeys.has(key))) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin network policy contains unsupported fields.");
		for (const key of networkKeys) if (network[key] !== undefined && (!Array.isArray(network[key]) || network[key].some(value => typeof value !== "string"))) throw new PreconditionsError("invalid_execution_mode", "Inherited Gondolin network rules must be string arrays.");
	}
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
