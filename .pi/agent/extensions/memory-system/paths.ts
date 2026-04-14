import { access, readdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { MemoryPaths } from "./contracts.js";

export interface PathResolutionOptions {
	agentRoot?: string;
	projectRoot?: string;
}

async function canonicalize(path: string): Promise<string> {
	const resolved = resolve(path);
	try {
		return await realpath(resolved);
	} catch {
		return resolved;
	}
}

export async function resolveAgentRoot(options: PathResolutionOptions = {}): Promise<string> {
	const configured =
		options.agentRoot ?? process.env.PI_MEMORY_SYSTEM_AGENT_ROOT ?? process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent");
	return canonicalize(configured);
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

export async function resolveProjectRoot(cwd: string, options: PathResolutionOptions = {}): Promise<string> {
	if (options.projectRoot) return canonicalize(options.projectRoot);
	const agentRoot = await resolveAgentRoot(options);
	const canonicalCwd = await canonicalize(cwd);
	if (isSameOrNested(agentRoot, canonicalCwd)) {
		return agentRoot;
	}
	const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (git.status === 0 && git.stdout.trim()) {
		return canonicalize(git.stdout.trim());
	}
	const anchoredAncestor = await findAnchoredAncestor(canonicalCwd);
	return anchoredAncestor ?? canonicalCwd;
}

async function listDecisionPaths(decisionsDir: string): Promise<string[]> {
	try {
		const entries = await readdir(decisionsDir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => join(decisionsDir, entry.name))
			.sort((left, right) => left.localeCompare(right));
	} catch {
		return [];
	}
}

export async function resolveMemoryPaths(cwd: string, options: PathResolutionOptions = {}): Promise<MemoryPaths> {
	const agentRoot = await resolveAgentRoot(options);
	const projectRoot = await resolveProjectRoot(cwd, options);
	const sameRoot = agentRoot === projectRoot;
	const globalAiDir = join(agentRoot, ".ai");
	const projectAiDir = join(projectRoot, ".ai");
	const decisionsDir = join(projectAiDir, "decisions");
	const decisionPaths = await listDecisionPaths(decisionsDir);

	const learnings = {
		globalPath: join(globalAiDir, "global-learning.md"),
		projectPath: join(projectAiDir, "learning.md"),
	};

	return {
		agentRoot,
		projectRoot,
		sameRoot,
		globalAiDir,
		projectAiDir,
		userProfilePath: join(globalAiDir, "user-profile.md"),
		projectProfilePath: join(projectAiDir, "project-profile.md"),
		currentWorkPath: join(projectAiDir, "current-work.md"),
		pendingLearningsPath: join(projectAiDir, "pending-learnings.md"),
		pendingMemoryProposalsPath: join(projectAiDir, "pending-memory-proposals.md"),
		referencesIndexPath: join(projectAiDir, "references", "index.md"),
		projectMemoryPaths: {
			project: join(projectAiDir, "project.md"),
			conventions: join(projectAiDir, "conventions.md"),
			pitfalls: join(projectAiDir, "pitfalls.md"),
			decisionsDir,
			decisionPaths,
		},
		learnings,
	};
}
