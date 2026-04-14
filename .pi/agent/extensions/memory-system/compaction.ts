import { basename } from "node:path";
import type { MemoryCompactionState, MemoryPaths, MemoryScope, MemorySnippet, PreservedMemoryHint } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import {
	collectKeyLines,
	compactLines,
	getMarkdownTitle,
	keywordsFromText,
	matchedKeywords,
	readOptionalText,
} from "./markdown.js";
import { loadLearningStore, rankLearningSnippets } from "./learnings.js";
import { loadProfileSummary, profileSummaryToSnippet } from "./profiles.js";
import { loadWorkingMemorySummary } from "./working-memory.js";

interface FileOpsLike {
	read?: Set<string>;
	written?: Set<string>;
	edited?: Set<string>;
}

interface CompactionPreparationLike {
	firstKeptEntryId: string;
	tokensBefore: number;
	previousSummary?: string;
	fileOps: FileOpsLike;
}

interface BuildCompactionOptions {
	paths: MemoryPaths;
	preparation: CompactionPreparationLike;
	prompt?: string;
}

function computeFileLists(fileOps: FileOpsLike): { readFiles: string[]; modifiedFiles: string[] } {
	const read = [...(fileOps.read ?? new Set<string>())];
	const written = [...(fileOps.written ?? new Set<string>())];
	const edited = [...(fileOps.edited ?? new Set<string>())];
	const modified = new Set([...written, ...edited]);
	return {
		readFiles: read.filter((file) => !modified.has(file)).sort((left, right) => left.localeCompare(right)),
		modifiedFiles: [...modified].sort((left, right) => left.localeCompare(right)),
	};
}

function snippetToHint(snippet: MemorySnippet): PreservedMemoryHint {
	return {
		kind: snippet.kind,
		scope: snippet.scope,
		sourcePath: snippet.sourcePath,
		title: snippet.title,
		summary: snippet.summary,
		requiresValidation: snippet.requiresValidation,
		validationReason: snippet.validationReason,
	};
}

async function loadGenericProjectSnippet(options: {
	path: string;
	kind: PreservedMemoryHint["kind"];
	scope: MemoryScope;
	fallbackTitle: string;
	promptKeywords: string[];
	basePriority: number;
}): Promise<MemorySnippet | undefined> {
	const raw = await readOptionalText(options.path);
	if (!raw) return undefined;
	const title = getMarkdownTitle(raw, options.fallbackTitle);
	const keyLines = compactLines(collectKeyLines(raw, 8), 6);
	if (keyLines.length === 0) return undefined;
	const combined = `${title}\n${keyLines.join("\n")}`;
	const matchedTerms = matchedKeywords(combined, options.promptKeywords);
	const orderedLines = matchedTerms.length > 0
		? [
				...keyLines.filter((line) => matchedTerms.some((term) => line.toLowerCase().includes(term))),
				...keyLines.filter((line) => !matchedTerms.some((term) => line.toLowerCase().includes(term))),
			]
		: keyLines;
	const summary = orderedLines.slice(0, 5).map((line) => `- ${line}`).join("\n");
	return {
		kind: options.kind,
		scope: options.scope,
		sourcePath: options.path,
		exists: true,
		title,
		summary,
		estimatedTokens: estimateTokens(summary),
		priority: options.basePriority + matchedTerms.length * 12,
		requiresValidation: true,
		validationReason: "Durable memory can drift; validate workspace facts before relying on them.",
		dedupeKey: normalizeForDedupe(`${title}:${summary}`),
		matchedTerms,
	};
}

async function collectPreservedHints(paths: MemoryPaths, prompt: string): Promise<PreservedMemoryHint[]> {
	const promptKeywords = keywordsFromText(prompt);
	const snippets: MemorySnippet[] = [];

	const projectProfile = await loadProfileSummary(
		{ kind: "project-profile", scope: "project", sourcePath: paths.projectProfilePath, exists: false },
		"Project Profile",
	);
	if (projectProfile) snippets.push(profileSummaryToSnippet(projectProfile, 82));

	const userProfile = await loadProfileSummary(
		{ kind: "user-profile", scope: "global", sourcePath: paths.userProfilePath, exists: false },
		"User Profile",
	);
	if (userProfile) snippets.push(profileSummaryToSnippet(userProfile, 68));

	const projectStore = await loadLearningStore(paths.learnings.projectPath, "project");
	if (projectStore) {
		snippets.push(...rankLearningSnippets({
			records: projectStore.records,
			target: "project",
			promptKeywords,
			classification: "feature-continuation",
		}));
	}

	const globalStore = await loadLearningStore(paths.learnings.globalPath, "global");
	if (globalStore) {
		snippets.push(...rankLearningSnippets({
			records: globalStore.records,
			target: "global",
			promptKeywords,
			classification: "feature-continuation",
		}));
	}

	const durableCandidates = [
		{ kind: "conventions" as const, path: paths.projectMemoryPaths.conventions, title: "Conventions", priority: 76 },
		{ kind: "pitfalls" as const, path: paths.projectMemoryPaths.pitfalls, title: "Pitfalls", priority: 74 },
	];
	for (const candidate of durableCandidates) {
		const snippet = await loadGenericProjectSnippet({
			path: candidate.path,
			kind: candidate.kind,
			scope: "project",
			fallbackTitle: candidate.title,
			promptKeywords,
			basePriority: candidate.priority,
		});
		if (snippet) snippets.push(snippet);
	}

	for (const decisionPath of paths.projectMemoryPaths.decisionPaths) {
		const snippet = await loadGenericProjectSnippet({
			path: decisionPath,
			kind: "decision",
			scope: "project",
			fallbackTitle: basename(decisionPath, ".md"),
			promptKeywords,
			basePriority: 70,
		});
		if (snippet) snippets.push(snippet);
	}

	const unique = new Set<string>();
	return snippets
		.sort((left, right) => right.priority - left.priority)
		.filter((snippet) => {
			if (snippet.kind === "current-work" || unique.has(snippet.dedupeKey)) return false;
			unique.add(snippet.dedupeKey);
			return true;
		})
		.slice(0, 6)
		.map(snippetToHint);
}

export async function buildMemoryCompactionState(options: BuildCompactionOptions): Promise<MemoryCompactionState> {
	const workingMemory = await loadWorkingMemorySummary({
		kind: "current-work",
		scope: "feature",
		sourcePath: options.paths.currentWorkPath,
		exists: false,
	});
	const prompt =
		options.prompt?.trim() ||
		workingMemory?.nextRestartStep ||
		workingMemory?.currentState ||
		workingMemory?.objective ||
		"continue the active feature work";
	const { readFiles, modifiedFiles } = computeFileLists(options.preparation.fileOps);
	const preservedHints = await collectPreservedHints(options.paths, prompt);
	const keyChangedFiles = compactLines([...(workingMemory?.changedFiles ?? []), ...modifiedFiles], 8);
	return {
		version: 1,
		generatedAt: new Date().toISOString(),
		activeSlug: workingMemory?.slug,
		objective: workingMemory?.objective,
		currentState: workingMemory?.currentState,
		decisions: compactLines(workingMemory?.decisions ?? [], 4),
		blockers: compactLines(workingMemory?.openQuestions ?? [], 4),
		reviewFindings: compactLines(workingMemory?.reviewFindings ?? [], 4),
		nextRestartStep: workingMemory?.nextRestartStep,
		keyChangedFiles,
		preservedHints,
		readFiles,
		modifiedFiles,
	};
}

export function renderMemoryCompactionSummary(state: MemoryCompactionState): string {
	const lines: string[] = [];
	lines.push("## Goal");
	lines.push(state.objective ?? "Continue the active tracked work using the preserved restart state.");
	lines.push("");
	lines.push("## Constraints & Preferences");
	lines.push("- Treat preserved memory hints as hints only. Validate live workspace facts before relying on them.");
	lines.push("- Prefer the latest `.ai/current-work.md`, profiles, and durable memory over compacted session hints when they disagree.");
	lines.push("");
	lines.push("## Progress");
	lines.push("### Done");
	lines.push(`- [x] Preserved memory-aware compaction state for ${state.activeSlug ?? "the active feature"}.`);
	lines.push("");
	lines.push("### In Progress");
	lines.push(`- [ ] ${state.currentState ?? state.nextRestartStep ?? "Resume the active feature work."}`);
	lines.push("");
	lines.push("### Blocked");
	if (state.blockers.length === 0) lines.push("- (none)");
	for (const blocker of state.blockers) lines.push(`- ${blocker}`);
	lines.push("");
	lines.push("## Key Decisions");
	if (state.decisions.length === 0) lines.push("- **None captured**: Re-read `.ai/current-work.md` for the latest rationale.");
	for (const decision of state.decisions) lines.push(`- **Decision**: ${decision}`);
	lines.push("");
	lines.push("## Next Steps");
	lines.push(`1. ${state.nextRestartStep ?? "Re-read `.ai/current-work.md` and resume from the active restart step."}`);
	lines.push("");
	lines.push("## Critical Context");
	if (state.reviewFindings.length > 0) {
		for (const finding of state.reviewFindings) lines.push(`- Review finding: ${finding}`);
	}
	if (state.keyChangedFiles.length > 0) {
		lines.push(`- Key changed files: ${state.keyChangedFiles.join(", ")}`);
	}
	for (const hint of state.preservedHints.slice(0, 6)) {
		lines.push(`- Hint from ${hint.sourcePath}: ${hint.title} — ${hint.summary.replace(/\n+/g, " ")}`);
	}
	if (state.reviewFindings.length === 0 && state.keyChangedFiles.length === 0 && state.preservedHints.length === 0) {
		lines.push("- (none)");
	}
	if (state.readFiles.length > 0) {
		lines.push("");
		lines.push("<read-files>");
		for (const file of state.readFiles) lines.push(file);
		lines.push("</read-files>");
	}
	if (state.modifiedFiles.length > 0) {
		lines.push("");
		lines.push("<modified-files>");
		for (const file of state.modifiedFiles) lines.push(file);
		lines.push("</modified-files>");
	}
	return lines.join("\n");
}

export async function buildMemoryCompactionResult(options: BuildCompactionOptions): Promise<{
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details: MemoryCompactionState;
}> {
	const details = await buildMemoryCompactionState(options);
	return {
		summary: renderMemoryCompactionSummary(details),
		firstKeptEntryId: options.preparation.firstKeptEntryId,
		tokensBefore: options.preparation.tokensBefore,
		details,
	};
}

export function isMemoryCompactionState(value: unknown): value is MemoryCompactionState {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<MemoryCompactionState>;
	return candidate.version === 1 && Array.isArray(candidate.decisions) && Array.isArray(candidate.preservedHints);
}

export function loadLatestMemoryCompactionState(entries: Array<{ type?: string; details?: unknown }>): MemoryCompactionState | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "compaction") continue;
		if (isMemoryCompactionState(entry.details)) return entry.details;
	}
	return undefined;
}

export function memoryCompactionStateToSnippet(state: MemoryCompactionState, priority: number): MemorySnippet {
	const lines: string[] = [];
	if (state.activeSlug) lines.push(`- active-slug: ${state.activeSlug}`);
	if (state.nextRestartStep) lines.push(`- next-restart-step: ${state.nextRestartStep}`);
	if (state.reviewFindings[0]) lines.push(`- review-finding: ${state.reviewFindings[0]}`);
	if (state.keyChangedFiles.length > 0) lines.push(`- key-files: ${state.keyChangedFiles.slice(0, 2).join(", ")}`);
	if (state.preservedHints[0]) lines.push(`- hint: ${state.preservedHints[0].title} @ ${state.preservedHints[0].sourcePath}`);
	const summary = lines.join("\n");
	return {
		kind: "rehydrated-compaction",
		scope: "feature",
		sourcePath: `session-compaction:${state.generatedAt}`,
		exists: true,
		title: "Rehydrated Session Hints",
		summary,
		estimatedTokens: estimateTokens(summary),
		priority,
		requiresValidation: true,
		validationReason: "Compaction state preserves restart hints, not canonical workspace truth.",
		dedupeKey: normalizeForDedupe(summary),
	};
}
