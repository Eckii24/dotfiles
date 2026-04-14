import { basename } from "node:path";
import type {
	ArtifactKind,
	ContextDiagnostics,
	ContextPackage,
	ContextPackageType,
	MemoryCompactionState,
	MemoryPaths,
	MemoryScope,
	MemorySnippet,
	SkippedSource,
	TaskClassification,
} from "./contracts.js";
import {
	BASE_PACKAGE_TOKEN_BUDGET,
	MAX_BASE_SNIPPETS,
	MAX_TASK_SNIPPETS,
	TASK_AUGMENTATION_TOKEN_BUDGET,
	buildBudgetInfo,
	estimateTokens,
	hashText,
	normalizeForDedupe,
} from "./contracts.js";
import {
	collectKeyLines,
	compactLines,
	getMarkdownTitle,
	keywordsFromText,
	matchedKeywords,
	readOptionalText,
} from "./markdown.js";
import {
	loadLearningStore,
	loadPendingLearnings,
	pendingLearningsToSnippet,
	rankLearningSnippets,
	summarizePendingLearnings,
} from "./learnings.js";
import { memoryCompactionStateToSnippet } from "./compaction.js";
import {
	loadPendingMemoryProposals,
	pendingMemoryProposalsToSnippet,
	summarizePendingMemoryProposals,
} from "./promotions.js";
import { loadProfileSummary, profileSummaryToSnippet } from "./profiles.js";
import { rankReferenceSnippets } from "./references.js";
import { loadWorkingMemorySummary, workingMemoryToSnippet } from "./working-memory.js";

interface BasePackageOptions {
	preservedCompactionState?: MemoryCompactionState;
}

interface TaskPackageOptions extends BasePackageOptions {
	excludeDedupeKeys?: Set<string>;
}

function createSkipped(kind: ArtifactKind, sourcePath: string, reason: string): SkippedSource {
	return { kind, sourcePath, reason };
}

function formatSourceLabel(snippet: MemorySnippet): string {
	return `${snippet.sourcePath} (${snippet.scope})`;
}

function classifyTask(prompt: string): TaskClassification {
	const lowered = prompt.toLowerCase();
	if (
		/(continue|resume|restart|next step|current-work|current work|pick up where|pick up|implement the whole plan)/.test(lowered) ||
		(/phase\s+\d/.test(lowered) && /(implement|continue|plan|phase)/.test(lowered))
	) {
		return "feature-continuation";
	}
	if (/(reference|references|research|docs|documentation|readme|summari[sz]e|look up|lookup)/.test(lowered)) {
		return "reference-lookup";
	}
	if (/(implement|fix|refactor|review|extension|script|eval|prompt|agent|repo|code|file|plan)/.test(lowered)) {
		return "repo-implementation";
	}
	return "general-global";
}

function renderSnippetBlock(snippet: MemorySnippet): string {
	const lines: string[] = [];
	lines.push(`## ${snippet.title}`);
	lines.push(`- Source: ${formatSourceLabel(snippet)}`);
	if (snippet.requiresValidation) {
		lines.push(`- Validation: ${snippet.validationReason ?? "Validate against the live workspace before relying on this."}`);
	}
	lines.push(snippet.summary);
	return lines.join("\n");
}

function measureSnippet(snippet: MemorySnippet): MemorySnippet {
	const estimatedTokens = estimateTokens(renderSnippetBlock(snippet));
	return { ...snippet, estimatedTokens };
}

function renderInjectedContent(options: {
	packageType: ContextPackageType;
	classification?: TaskClassification;
	selected: MemorySnippet[];
}): string {
	const lines: string[] = [];
	lines.push(options.packageType === "base" ? "Memory system base package" : "Memory system task augmentation");
	if (options.classification) {
		lines.push(`Task classification: ${options.classification}`);
	}
	if (options.selected.some((snippet) => snippet.requiresValidation)) {
		lines.push("Treat repo-memory snippets as hints only. Validate workspace facts against live files before relying on them.");
	}
	for (const snippet of options.selected) {
		lines.push("");
		lines.push(renderSnippetBlock(snippet));
	}
	return lines.join("\n");
}

function selectWithinBudget(options: {
	packageType: ContextPackageType;
	classification?: TaskClassification;
	candidates: MemorySnippet[];
	budget: number;
	maxSnippets: number;
	skipped: SkippedSource[];
	excludedDedupeKeys?: Set<string>;
}): { selected: MemorySnippet[]; used: number } {
	const selected: MemorySnippet[] = [];
	const seen = new Set<string>(options.excludedDedupeKeys ?? []);

	for (const rawCandidate of [...options.candidates].sort((left, right) => right.priority - left.priority)) {
		const candidate = measureSnippet(rawCandidate);
		if (seen.has(candidate.dedupeKey)) {
			options.skipped.push(createSkipped(candidate.kind, candidate.sourcePath, "Duplicate of an already selected snippet."));
			continue;
		}
		if (selected.length >= options.maxSnippets) {
			options.skipped.push(createSkipped(candidate.kind, candidate.sourcePath, `Snippet cap (${options.maxSnippets}) reached.`));
			continue;
		}

		const tentative = [...selected, candidate];
		const tentativeUsed = estimateTokens(
			renderInjectedContent({
				packageType: options.packageType,
				classification: options.classification,
				selected: tentative,
			}),
		);
		if (tentativeUsed > options.budget) {
			options.skipped.push(createSkipped(candidate.kind, candidate.sourcePath, `Rendered package would exceed ${options.budget} tokens.`));
			continue;
		}

		selected.push(candidate);
		seen.add(candidate.dedupeKey);
	}

	const used = estimateTokens(
		renderInjectedContent({
			packageType: options.packageType,
			classification: options.classification,
			selected,
		}),
	);
	return { selected, used };
}

async function loadGenericProjectSnippet(options: {
	path: string;
	kind: ArtifactKind;
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
		priority: options.basePriority + matchedTerms.length * 15,
		requiresValidation: true,
		validationReason: "Durable memory can drift; validate workspace facts before relying on them.",
		dedupeKey: normalizeForDedupe(`${title}:${summary}`),
		matchedTerms,
	};
}

async function addBaseFallbackCandidates(paths: MemoryPaths, skipped: SkippedSource[], candidates: MemorySnippet[]): Promise<void> {
	const fallbackCandidates = [
		{ kind: "project-memory" as const, path: paths.projectMemoryPaths.project, title: "Project Memory", priority: 78 },
		{ kind: "conventions" as const, path: paths.projectMemoryPaths.conventions, title: "Conventions", priority: 82 },
		{ kind: "pitfalls" as const, path: paths.projectMemoryPaths.pitfalls, title: "Pitfalls", priority: 74 },
	];
	for (const fallback of fallbackCandidates) {
		const snippet = await loadGenericProjectSnippet({
			path: fallback.path,
			kind: fallback.kind,
			scope: "project",
			fallbackTitle: fallback.title,
			promptKeywords: [],
			basePriority: fallback.priority,
		});
		if (snippet) candidates.push(snippet);
		else skipped.push(createSkipped(fallback.kind, fallback.path, "File not found or no extractable fallback highlights."));
	}
}

export async function buildBaseContextPackage(paths: MemoryPaths, options: BasePackageOptions = {}): Promise<ContextPackage> {
	const candidates: MemorySnippet[] = [];
	const skipped: SkippedSource[] = [];
	let missingProfile = false;

	const userProfile = await loadProfileSummary(
		{ kind: "user-profile", scope: "global", sourcePath: paths.userProfilePath, exists: false },
		"User Profile",
	);
	if (userProfile) candidates.push(profileSummaryToSnippet(userProfile, 70));
	else {
		missingProfile = true;
		skipped.push(createSkipped("user-profile", paths.userProfilePath, "File not found."));
	}

	const projectProfile = await loadProfileSummary(
		{ kind: "project-profile", scope: "project", sourcePath: paths.projectProfilePath, exists: false },
		"Project Profile",
	);
	if (projectProfile) candidates.push(profileSummaryToSnippet(projectProfile, 85));
	else {
		missingProfile = true;
		skipped.push(createSkipped("project-profile", paths.projectProfilePath, "File not found."));
	}

	const workingMemory = await loadWorkingMemorySummary({
		kind: "current-work",
		scope: "feature",
		sourcePath: paths.currentWorkPath,
		exists: false,
	});
	if (workingMemory) candidates.push(workingMemoryToSnippet(workingMemory, 100));
	else skipped.push(createSkipped("current-work", paths.currentWorkPath, "File not found."));

	const pendingLearnings = await loadPendingLearnings(paths.pendingLearningsPath);
	if (pendingLearnings && pendingLearnings.recommendations.length > 0) {
		candidates.push(pendingLearningsToSnippet(summarizePendingLearnings(pendingLearnings)));
	} else {
		skipped.push(createSkipped("pending-learnings", paths.pendingLearningsPath, "No pending learning recommendations queued."));
	}

	const pendingMemoryProposals = await loadPendingMemoryProposals(paths.pendingMemoryProposalsPath);
	if (pendingMemoryProposals && pendingMemoryProposals.proposals.length > 0) {
		candidates.push(pendingMemoryProposalsToSnippet(summarizePendingMemoryProposals(pendingMemoryProposals)));
	} else {
		skipped.push(createSkipped("pending-memory-proposals", paths.pendingMemoryProposalsPath, "No pending durable/profile proposals queued."));
	}

	if (options.preservedCompactionState) {
		candidates.push(memoryCompactionStateToSnippet(options.preservedCompactionState, 58));
	}

	if (missingProfile) {
		await addBaseFallbackCandidates(paths, skipped, candidates);
	}

	const selection = selectWithinBudget({
		packageType: "base",
		candidates,
		budget: BASE_PACKAGE_TOKEN_BUDGET,
		maxSnippets: MAX_BASE_SNIPPETS,
		skipped,
	});
	const diagnostics: ContextDiagnostics = {
		packageType: "base",
		selected: selection.selected,
		skipped,
		budget: buildBudgetInfo(BASE_PACKAGE_TOKEN_BUDGET, selection.used),
	};
	const content = renderInjectedContent({ packageType: "base", selected: diagnostics.selected });
	return {
		packageType: "base",
		content,
		hash: hashText(content),
		diagnostics,
	};
}

export async function buildTaskContextPackage(
	paths: MemoryPaths,
	prompt: string,
	options: TaskPackageOptions = {},
): Promise<ContextPackage> {
	const classification = classifyTask(prompt);
	const promptKeywords = keywordsFromText(prompt);
	const candidates: MemorySnippet[] = [];
	const skipped: SkippedSource[] = [];

	if (classification !== "general-global") {
		const workingMemory = await loadWorkingMemorySummary({
			kind: "current-work",
			scope: "feature",
			sourcePath: paths.currentWorkPath,
			exists: false,
		});
		if (workingMemory) {
			candidates.push(workingMemoryToSnippet(workingMemory, classification === "feature-continuation" ? 110 : 95));
		} else {
			skipped.push(createSkipped("current-work", paths.currentWorkPath, "File not found."));
		}

		const projectProfile = await loadProfileSummary(
			{ kind: "project-profile", scope: "project", sourcePath: paths.projectProfilePath, exists: false },
			"Project Profile",
		);
		if (projectProfile) {
			candidates.push(profileSummaryToSnippet(projectProfile, classification === "repo-implementation" ? 88 : 75));
		} else {
			skipped.push(createSkipped("project-profile", paths.projectProfilePath, "File not found."));
		}
	} else {
		skipped.push(createSkipped("current-work", paths.currentWorkPath, "Skipped for general-global tasks."));
		skipped.push(createSkipped("project-profile", paths.projectProfilePath, "Skipped for general-global tasks."));
	}

	const userProfile = await loadProfileSummary(
		{ kind: "user-profile", scope: "global", sourcePath: paths.userProfilePath, exists: false },
		"User Profile",
	);
	if (userProfile) {
		candidates.push(profileSummaryToSnippet(userProfile, classification === "general-global" ? 80 : 55));
	} else {
		skipped.push(createSkipped("user-profile", paths.userProfilePath, "File not found."));
	}

	const projectLearningStore = await loadLearningStore(paths.learnings.projectPath, "project");
	if (projectLearningStore && projectLearningStore.records.length > 0) {
		candidates.push(
			...rankLearningSnippets({
				records: projectLearningStore.records,
				target: "project",
				promptKeywords,
				classification,
				skipped,
			}),
		);
	} else {
		skipped.push(createSkipped("learning-project", paths.learnings.projectPath, "File not found or no active learning records."));
	}

	const globalLearningStore = await loadLearningStore(paths.learnings.globalPath, "global");
	if (globalLearningStore && globalLearningStore.records.length > 0) {
		candidates.push(
			...rankLearningSnippets({
				records: globalLearningStore.records,
				target: "global",
				promptKeywords,
				classification,
				skipped,
			}),
		);
	} else {
		skipped.push(createSkipped("learning-global", paths.learnings.globalPath, "File not found or no active learning records."));
	}

	if (classification !== "general-global") {
		const projectMemoryCandidates = [
			{ kind: "project-memory" as const, path: paths.projectMemoryPaths.project, title: "Project Memory", priority: 62 },
			{ kind: "conventions" as const, path: paths.projectMemoryPaths.conventions, title: "Conventions", priority: 72 },
			{ kind: "pitfalls" as const, path: paths.projectMemoryPaths.pitfalls, title: "Pitfalls", priority: 68 },
		];

		for (const candidate of projectMemoryCandidates) {
			const snippet = await loadGenericProjectSnippet({
				path: candidate.path,
				kind: candidate.kind,
				scope: "project",
				fallbackTitle: candidate.title,
				promptKeywords,
				basePriority: candidate.priority,
			});
			if (snippet) candidates.push(snippet);
			else skipped.push(createSkipped(candidate.kind, candidate.path, "File not found or no extractable highlights."));
		}

		for (const decisionPath of paths.projectMemoryPaths.decisionPaths) {
			const snippet = await loadGenericProjectSnippet({
				path: decisionPath,
				kind: "decision",
				scope: "project",
				fallbackTitle: basename(decisionPath, ".md"),
				promptKeywords,
				basePriority: 54,
			});
			if (!snippet) {
				skipped.push(createSkipped("decision", decisionPath, "File not found or no extractable highlights."));
				continue;
			}
			if ((snippet.matchedTerms?.length ?? 0) === 0 && classification !== "feature-continuation") {
				skipped.push(createSkipped("decision", decisionPath, "Decision did not match this task strongly enough."));
				continue;
			}
			candidates.push(snippet);
		}

		candidates.push(
			...(await rankReferenceSnippets({
				indexPath: paths.referencesIndexPath,
				promptKeywords,
				classification,
				skipped,
			})),
		);
	} else {
		skipped.push(createSkipped("project-memory", paths.projectMemoryPaths.project, "Skipped for general-global tasks."));
		skipped.push(createSkipped("conventions", paths.projectMemoryPaths.conventions, "Skipped for general-global tasks."));
		skipped.push(createSkipped("pitfalls", paths.projectMemoryPaths.pitfalls, "Skipped for general-global tasks."));
		for (const decisionPath of paths.projectMemoryPaths.decisionPaths) {
			skipped.push(createSkipped("decision", decisionPath, "Skipped for general-global tasks."));
		}
		skipped.push(createSkipped("references-index", paths.referencesIndexPath, "Skipped for general-global tasks."));
	}

	if (options.preservedCompactionState) {
		candidates.push(memoryCompactionStateToSnippet(options.preservedCompactionState, classification === "feature-continuation" ? 130 : 60));
	}

	const selection = selectWithinBudget({
		packageType: "task",
		classification,
		candidates,
		budget: TASK_AUGMENTATION_TOKEN_BUDGET,
		maxSnippets: MAX_TASK_SNIPPETS,
		skipped,
		excludedDedupeKeys: options.excludeDedupeKeys,
	});
	const diagnostics: ContextDiagnostics = {
		packageType: "task",
		classification,
		selected: selection.selected,
		skipped,
		budget: buildBudgetInfo(TASK_AUGMENTATION_TOKEN_BUDGET, selection.used),
	};
	const content = renderInjectedContent({
		packageType: "task",
		classification,
		selected: diagnostics.selected,
	});
	return {
		packageType: "task",
		content,
		hash: hashText(content),
		diagnostics,
	};
}

export function formatMemoryStatusReport(paths: MemoryPaths, basePackage: ContextPackage, taskPackage?: ContextPackage): string {
	const lines: string[] = [];
	lines.push("Memory status");
	lines.push(`Agent root: ${paths.agentRoot}`);
	lines.push(`Project root: ${paths.projectRoot}`);
	lines.push(`Same root: ${paths.sameRoot ? "yes" : "no"}`);
	lines.push(`Global learning path: ${paths.learnings.globalPath}`);
	lines.push(`Project learning path: ${paths.learnings.projectPath}`);
	lines.push(`Pending learnings path: ${paths.pendingLearningsPath}`);
	lines.push(`Pending memory proposals path: ${paths.pendingMemoryProposalsPath}`);
	lines.push(`References index path: ${paths.referencesIndexPath}`);
	lines.push("");
	lines.push(`Base package: ${basePackage.diagnostics.budget.used}/${basePackage.diagnostics.budget.limit} estimated tokens`);
	for (const snippet of basePackage.diagnostics.selected) {
		lines.push(`- ${snippet.title}: ${snippet.sourcePath}`);
	}
	if (basePackage.diagnostics.skipped.length > 0) {
		lines.push("Skipped base sources:");
		for (const skipped of basePackage.diagnostics.skipped.slice(0, 8)) {
			lines.push(`- ${skipped.sourcePath}: ${skipped.reason}`);
		}
	}
	if (taskPackage) {
		lines.push("");
		lines.push(
			`Task package (${taskPackage.diagnostics.classification ?? "unclassified"}): ${taskPackage.diagnostics.budget.used}/${taskPackage.diagnostics.budget.limit} estimated tokens`,
		);
		for (const snippet of taskPackage.diagnostics.selected) {
			const matched = snippet.matchedTerms?.length ? ` [matched: ${snippet.matchedTerms.join(", ")}]` : "";
			lines.push(`- ${snippet.title}: ${snippet.sourcePath}${matched}`);
		}
		if (taskPackage.diagnostics.skipped.length > 0) {
			lines.push("Skipped task sources:");
			for (const skipped of taskPackage.diagnostics.skipped.slice(0, 10)) {
				lines.push(`- ${skipped.sourcePath}: ${skipped.reason}`);
			}
		}
	}
	return lines.join("\n");
}
