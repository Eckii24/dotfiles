import { createHash } from "node:crypto";

export const BASE_PACKAGE_TOKEN_BUDGET = 800;
export const TASK_AUGMENTATION_TOKEN_BUDGET = 1200;
export const TOTAL_MEMORY_TOKEN_BUDGET = 2000;
export const MAX_BASE_SNIPPETS = 4;
export const MAX_TASK_SNIPPETS = 7;

export type MemoryScope = "global" | "project" | "feature";
export type ContextPackageType = "base" | "task";
export type TaskClassification =
	| "feature-continuation"
	| "repo-implementation"
	| "reference-lookup"
	| "general-global";

export type ArtifactKind =
	| "user-profile"
	| "project-profile"
	| "current-work"
	| "project-memory"
	| "conventions"
	| "pitfalls"
	| "decision"
	| "learning-global"
	| "learning-project"
	| "pending-learnings"
	| "pending-memory-proposals"
	| "references-index"
	| "reference-note"
	| "rehydrated-compaction";

export interface SourcePathMeta {
	kind: ArtifactKind;
	scope: MemoryScope;
	sourcePath: string;
	exists: boolean;
}

export interface LearningsPaths {
	globalPath: string;
	projectPath: string;
}

export interface MemoryPaths {
	agentRoot: string;
	projectRoot: string;
	sameRoot: boolean;
	globalAiDir: string;
	projectAiDir: string;
	userProfilePath: string;
	projectProfilePath: string;
	currentWorkPath: string;
	pendingLearningsPath: string;
	pendingMemoryProposalsPath: string;
	referencesIndexPath: string;
	projectMemoryPaths: {
		project: string;
		conventions: string;
		pitfalls: string;
		decisionsDir: string;
		decisionPaths: string[];
	};
	learnings: LearningsPaths;
}

export interface BudgetInfo {
	limit: number;
	used: number;
	remaining: number;
}

export interface SkippedSource {
	kind: ArtifactKind;
	sourcePath: string;
	reason: string;
}

export interface MemorySnippet extends SourcePathMeta {
	title: string;
	summary: string;
	estimatedTokens: number;
	priority: number;
	requiresValidation: boolean;
	validationReason?: string;
	dedupeKey: string;
	matchedTerms?: string[];
}

export interface ContextDiagnostics {
	packageType: ContextPackageType;
	classification?: TaskClassification;
	selected: MemorySnippet[];
	skipped: SkippedSource[];
	budget: BudgetInfo;
}

export interface ContextPackage {
	packageType: ContextPackageType;
	content: string;
	hash: string;
	diagnostics: ContextDiagnostics;
}

export interface ProfileSummary {
	source: SourcePathMeta;
	title: string;
	highlights: string[];
	estimatedTokens: number;
}

export interface WorkingMemorySummary {
	source: SourcePathMeta;
	slug?: string;
	status?: string;
	objective?: string;
	currentState?: string;
	nextRestartStep?: string;
	openQuestions: string[];
	decisions: string[];
	reviewFindings: string[];
	changedFiles: string[];
	estimatedTokens: number;
}

export interface PreservedMemoryHint {
	kind: ArtifactKind;
	scope: MemoryScope;
	sourcePath: string;
	title: string;
	summary: string;
	requiresValidation: boolean;
	validationReason?: string;
}

export interface MemoryCompactionState {
	version: 1;
	generatedAt: string;
	activeSlug?: string;
	objective?: string;
	currentState?: string;
	decisions: string[];
	blockers: string[];
	reviewFindings: string[];
	nextRestartStep?: string;
	keyChangedFiles: string[];
	preservedHints: PreservedMemoryHint[];
	readFiles: string[];
	modifiedFiles: string[];
}

export function estimateTokens(text: string): number {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return 0;
	return Math.ceil(normalized.length / 4);
}

export function normalizeForDedupe(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

export function buildBudgetInfo(limit: number, used: number): BudgetInfo {
	return {
		limit,
		used,
		remaining: Math.max(0, limit - used),
	};
}
