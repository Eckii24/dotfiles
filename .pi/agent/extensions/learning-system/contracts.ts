import { createHash } from "node:crypto";

export type LearningScope = "global" | "project";
export type LearningStatus = "approved" | "pending";

export interface LearningsPaths {
	globalDir: string;
	projectDir: string;
	globalPendingDir: string;
	projectPendingDir: string;
}

export interface LearningSystemPaths extends LearningsPaths {
	agentRoot: string;
	projectRoot: string;
	sameRoot: boolean;
	projectAiDir: string;
	globalLearningsRoot: string;
	globalAgentsPath: string;
	projectAgentsPath: string;
	legacyCleanupTargets: string[];
}

export interface ApprovedLearningFrontmatter {
	created: string;
	lastReviewed: string;
	summary: string;
}

export interface PendingLearningFrontmatter {
	created: string;
	summary: string;
}

export type LearningFrontmatter = ApprovedLearningFrontmatter | PendingLearningFrontmatter;

export interface ScannedLearning<TFrontmatter extends LearningFrontmatter = LearningFrontmatter> {
	path: string;
	filename: string;
	frontmatter: TFrontmatter;
	scope: LearningScope;
	status: LearningStatus;
}

export interface LearningDocument<TFrontmatter extends LearningFrontmatter = LearningFrontmatter>
	extends ScannedLearning<TFrontmatter> {
	body: string;
	rawFrontmatter: Record<string, string>;
}

export interface LearningSections {
	why?: string;
	whenToApply?: string;
	whenNotToApply?: string;
	details?: string;
}

export interface PendingLearningCandidate {
	summary: string;
	body: string;
	scope?: LearningScope;
	filename?: string;
	created?: string;
}

export interface CollisionInfo {
	slug: string;
	path: string;
	filename: string;
	scope: LearningScope;
	status: LearningStatus;
}

export interface CreateLearningResult {
	status: "created" | "collision";
	path?: string;
	filename: string;
	collision?: CollisionInfo;
}

export interface ScanSummary {
	project: ScannedLearning<ApprovedLearningFrontmatter>[];
	global: ScannedLearning<ApprovedLearningFrontmatter>[];
	total: number;
}

export interface PendingScanSummary {
	project: ScannedLearning<PendingLearningFrontmatter>[];
	global: ScannedLearning<PendingLearningFrontmatter>[];
	total: number;
}

export interface LearningInjection {
	header: string;
	content: string;
	hash: string;
	totalRefs: number;
}

export interface NormalizationIssue {
	path: string;
	type: "filename" | "frontmatter" | "body";
	reason: string;
	proposedValue?: string;
}

export interface PromotionPlacement {
	targetPath: string;
	sectionHeading: string;
	compactedText: string;
	alreadyPresent: boolean;
	confirmationToken: string;
}

export function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

export function normalizeForDedupe(text: string): string {
	return text.toLowerCase().replace(/[`*_>#-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function todayIso(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

export function isRealIsoDate(value: string | undefined): value is string {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
	const candidate = new Date(Date.UTC(year, month - 1, day));
	return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

export function normalizeIsoDate(value: string | undefined, fallback = todayIso()): string {
	const candidate = value?.trim();
	if (isRealIsoDate(candidate)) return candidate;
	return isRealIsoDate(fallback) ? fallback : todayIso();
}

export function isApprovedFrontmatter(value: LearningFrontmatter): value is ApprovedLearningFrontmatter {
	return "lastReviewed" in value;
}
