import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
	ApprovedLearningFrontmatter,
	LearningScope,
	LearningStatus,
	LearningSystemPaths,
	PendingLearningFrontmatter,
	PendingScanSummary,
	ScanSummary,
	ScannedLearning,
} from "./contracts.js";
import { collapseWhitespace, splitFrontmatter } from "./markdown.js";

export async function listMarkdownFiles(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => join(dir, entry.name))
			.sort((a, b) => a.localeCompare(b));
	} catch (error) {
		const candidate = error as NodeJS.ErrnoException;
		if (candidate.code === "ENOENT") return [];
		throw error;
	}
}

function parseFrontmatterForStatus(frontmatter: Record<string, string>, status: LearningStatus): ApprovedLearningFrontmatter | PendingLearningFrontmatter | undefined {
	if (status === "approved") {
		if (!frontmatter.created || !frontmatter.lastReviewed || !frontmatter.summary) return undefined;
		return {
			created: frontmatter.created,
			lastReviewed: frontmatter.lastReviewed,
			summary: collapseWhitespace(frontmatter.summary),
		};
	}
	if (!frontmatter.created || !frontmatter.summary) return undefined;
	return {
		created: frontmatter.created,
		summary: collapseWhitespace(frontmatter.summary),
	};
}

async function readFrontmatterOnly(path: string): Promise<Record<string, string> | undefined> {
	let handle;
	try {
		handle = await open(path, "r");
		let buffer = "";
		let position = 0;
		for (;;) {
			const chunk = Buffer.alloc(2048);
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
			if (bytesRead <= 0) break;
			position += bytesRead;
			buffer += chunk.subarray(0, bytesRead).toString("utf8");
			const closingIndex = buffer.indexOf("\n---", 4);
			if (buffer.startsWith("---\n") && closingIndex !== -1) {
				return splitFrontmatter(buffer.slice(0, closingIndex + 4)).frontmatter;
			}
		}
		return splitFrontmatter(buffer).frontmatter;
	} catch (error) {
		const candidate = error as NodeJS.ErrnoException;
		if (candidate.code === "ENOENT") return undefined;
		throw error;
	} finally {
		await handle?.close();
	}
}

async function scanDir<TFrontmatter extends ApprovedLearningFrontmatter | PendingLearningFrontmatter>(
	dir: string,
	scope: LearningScope,
	status: LearningStatus,
): Promise<ScannedLearning<TFrontmatter>[]> {
	const files = await listMarkdownFiles(dir);
	const scanned: ScannedLearning<TFrontmatter>[] = [];
	for (const path of files) {
		const frontmatter = await readFrontmatterOnly(path);
		if (!frontmatter) continue;
		const parsed = parseFrontmatterForStatus(frontmatter, status);
		if (!parsed) continue;
		scanned.push({
			path,
			filename: path.split(/[/\\]/).pop() ?? path,
			frontmatter: parsed as TFrontmatter,
			scope,
			status,
		});
	}
	return scanned;
}

export async function scanApprovedLearnings(paths: LearningSystemPaths): Promise<ScanSummary> {
	const [project, global] = await Promise.all([
		scanDir<ApprovedLearningFrontmatter>(paths.projectDir, "project", "approved"),
		scanDir<ApprovedLearningFrontmatter>(paths.globalDir, "global", "approved"),
	]);
	return { project, global, total: project.length + global.length };
}

export async function scanPendingLearnings(paths: LearningSystemPaths): Promise<PendingScanSummary> {
	const [project, global] = await Promise.all([
		scanDir<PendingLearningFrontmatter>(paths.projectPendingDir, "project", "pending"),
		scanDir<PendingLearningFrontmatter>(paths.globalPendingDir, "global", "pending"),
	]);
	return { project, global, total: project.length + global.length };
}

export async function listAllLearningFiles(
	paths: LearningSystemPaths,
): Promise<Array<{ path: string; scope: LearningScope; status: LearningStatus }>> {
	const [projectApproved, globalApproved, projectPending, globalPending] = await Promise.all([
		listMarkdownFiles(paths.projectDir),
		listMarkdownFiles(paths.globalDir),
		listMarkdownFiles(paths.projectPendingDir),
		listMarkdownFiles(paths.globalPendingDir),
	]);
	return [
		...projectApproved.map((path) => ({ path, scope: "project" as const, status: "approved" as const })),
		...globalApproved.map((path) => ({ path, scope: "global" as const, status: "approved" as const })),
		...projectPending.map((path) => ({ path, scope: "project" as const, status: "pending" as const })),
		...globalPending.map((path) => ({ path, scope: "global" as const, status: "pending" as const })),
	];
}
