import { access, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { LearningScope, LearningStatus, LearningSystemPaths } from "./contracts.js";

const BREAKING_CLEANUP_MARKER = ".learning-system-breaking-cleanup-v1";

export interface PathResolutionOptions {
	agentRoot?: string;
	projectRoot?: string;
	globalLearningsRoot?: string;
}

async function canonicalize(path: string): Promise<string> {
	const resolved = resolve(path);
	try {
		return await realpath(resolved);
	} catch {
		return resolved;
	}
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function isSameOrNested(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && rel !== "..");
}

async function findAnchoredAncestor(start: string): Promise<string | undefined> {
	let current = start;
	for (;;) {
		const hasAi = await pathExists(join(current, ".ai"));
		const hasAgents = await pathExists(join(current, "AGENTS.md"));
		if (hasAi || hasAgents) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export async function resolveAgentRoot(options: PathResolutionOptions = {}): Promise<string> {
	const configured =
		options.agentRoot ?? process.env.PI_CODING_AGENT_DIR ?? process.env.PI_LEARNING_SYSTEM_AGENT_ROOT ?? join(homedir(), ".pi", "agent");
	return canonicalize(configured);
}

export async function resolveProjectRoot(cwd: string, options: PathResolutionOptions = {}): Promise<string> {
	if (options.projectRoot) return canonicalize(options.projectRoot);
	const agentRoot = await resolveAgentRoot(options);
	const canonicalCwd = await canonicalize(cwd);
	if (isSameOrNested(agentRoot, canonicalCwd)) return agentRoot;

	const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (git.status === 0 && git.stdout.trim()) return canonicalize(git.stdout.trim());

	return (await findAnchoredAncestor(canonicalCwd)) ?? canonicalCwd;
}

export async function resolveLearningSystemPaths(cwd: string, options: PathResolutionOptions = {}): Promise<LearningSystemPaths> {
	const agentRoot = await resolveAgentRoot(options);
	const projectRoot = await resolveProjectRoot(cwd, options);
	const sameRoot = agentRoot === projectRoot;
	const projectAiDir = join(projectRoot, ".ai");
	const globalLearningsRoot = resolve(options.globalLearningsRoot ?? process.env.PI_LEARNING_SYSTEM_GLOBAL_ROOT ?? join(homedir(), ".agents"));
	const globalDir = join(globalLearningsRoot, "learnings");
	const projectDir = join(projectAiDir, "learnings");
	const globalPendingDir = join(globalDir, "pending");
	const projectPendingDir = join(projectDir, "pending");
	const legacyName = (name: string) => `${name}.${"md"}`;
	const legacyCleanupTargets = Array.from(new Set([
		join(projectAiDir, legacyName("learning")),
		join(projectAiDir, legacyName(["global", "learning"].join("-"))),
		join(projectAiDir, legacyName(["pending", "learnings"].join("-"))),
		join(projectAiDir, legacyName(["pending", "memory", "proposals"].join("-"))),
		join(agentRoot, ".ai", legacyName(["global", "learning"].join("-"))),
	]));

	return {
		agentRoot,
		projectRoot,
		sameRoot,
		projectAiDir,
		globalLearningsRoot,
		globalDir,
		projectDir,
		globalPendingDir,
		projectPendingDir,
		globalAgentsPath: join(agentRoot, "AGENTS.md"),
		projectAgentsPath: join(projectRoot, "AGENTS.md"),
		legacyCleanupTargets,
	};
}

function learningDir(paths: LearningSystemPaths, scope: LearningScope, status: LearningStatus): string {
	if (scope === "global") return status === "pending" ? paths.globalPendingDir : paths.globalDir;
	return status === "pending" ? paths.projectPendingDir : paths.projectDir;
}

async function assertPathUnderRoots(candidate: string, roots: string[], label: string): Promise<string> {
	const canonicalCandidate = await canonicalize(candidate);
	const canonicalRoots = await Promise.all(roots.map((root) => canonicalize(root)));
	if (!canonicalRoots.some((root) => isSameOrNested(root, canonicalCandidate))) {
		throw new Error(`${label} is outside the managed learning roots: ${candidate}`);
	}
	return canonicalCandidate;
}

export async function requireManagedLearningPath(
	paths: LearningSystemPaths,
	candidate: string,
	options: { scope?: LearningScope; status?: LearningStatus } = {},
): Promise<string> {
	const allowedRoots = options.scope && options.status
		? [learningDir(paths, options.scope, options.status)]
		: options.status
			? [learningDir(paths, "project", options.status), learningDir(paths, "global", options.status)]
			: options.scope
				? [learningDir(paths, options.scope, "approved"), learningDir(paths, options.scope, "pending")]
				: [paths.projectDir, paths.projectPendingDir, paths.globalDir, paths.globalPendingDir];
	const guarded = await assertPathUnderRoots(candidate, allowedRoots, "Learning path");
	if (options.status === "approved") {
		const pendingRoots = await Promise.all([paths.projectPendingDir, paths.globalPendingDir].map((root) => canonicalize(root)));
		if (pendingRoots.some((root) => isSameOrNested(root, guarded))) {
			throw new Error(`Learning path is outside the managed learning roots: ${candidate}`);
		}
	}
	if (!guarded.toLowerCase().endsWith(".md")) {
		throw new Error(`Learning path must point to a Markdown file: ${candidate}`);
	}
	return guarded;
}

export async function requireManagedAgentsPath(
	paths: LearningSystemPaths,
	candidate: string,
	target: LearningScope,
): Promise<string> {
	const expected = resolve(target === "global" ? paths.globalAgentsPath : paths.projectAgentsPath);
	const resolvedCandidate = resolve(candidate);
	if (resolvedCandidate !== expected) {
		throw new Error(`AGENTS.md mutations are restricted to ${expected}; received ${candidate}`);
	}
	const targetRoot = await canonicalize(target === "global" ? paths.agentRoot : paths.projectRoot);
	const canonicalExpected = await canonicalize(expected);
	if (!isSameOrNested(targetRoot, canonicalExpected)) {
		throw new Error(`AGENTS.md target escapes the managed ${target} root: ${expected}`);
	}
	return expected;
}

export async function ensureLearningsDirs(paths: LearningSystemPaths): Promise<string[]> {
	const changed: string[] = [];
	for (const dir of [paths.globalDir, paths.projectDir, paths.globalPendingDir, paths.projectPendingDir]) {
		const existed = await pathExists(dir);
		await mkdir(dir, { recursive: true });
		if (!existed) changed.push(dir);
	}
	return changed;
}

export async function cleanupLegacyFiles(
	paths: LearningSystemPaths,
	options: { mode?: "once" | "force" | "skip" } = {},
): Promise<string[]> {
	const mode = options.mode ?? "once";
	if (mode === "skip") return [];

	const groupedTargets = new Map<string, string[]>();
	for (const target of paths.legacyCleanupTargets) {
		const markerPath = join(dirname(target), BREAKING_CLEANUP_MARKER);
		const existing = groupedTargets.get(markerPath) ?? [];
		existing.push(target);
		groupedTargets.set(markerPath, existing);
	}

	const removed: string[] = [];
	for (const [markerPath, targets] of groupedTargets) {
		const markerDir = dirname(markerPath);
		if (mode === "once" && (await pathExists(markerPath))) continue;
		const existingTargets = [] as string[];
		for (const target of targets) {
			if (await pathExists(target)) existingTargets.push(target);
		}
		if (existingTargets.length === 0 && !(await pathExists(markerDir))) continue;
		for (const target of existingTargets) {
			try {
				await rm(target, { force: true });
				removed.push(target);
			} catch (error) {
				const candidate = error as NodeJS.ErrnoException;
				if (candidate.code !== "ENOENT") throw error;
			}
		}
		await mkdir(markerDir, { recursive: true });
		await writeFile(markerPath, "learning-system breaking cleanup complete\n", "utf8");
	}
	return removed;
}
