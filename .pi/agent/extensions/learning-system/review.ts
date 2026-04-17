import { basename, dirname, join } from "node:path";
import type {
	ApprovedLearningFrontmatter,
	LearningDocument,
	LearningScope,
	LearningStatus,
	LearningSystemPaths,
	NormalizationIssue,
	PendingLearningFrontmatter,
} from "./contracts.js";
import { isRealIsoDate, normalizeIsoDate, todayIso } from "./contracts.js";
import {
	collapseWhitespace,
	ensureStructuredLearningBody,
	hasStructuredBody,
	parseLearningSections,
	readOptionalText,
	renderFrontmatter,
	renderLearningBody,
	splitFrontmatter,
} from "./markdown.js";
import { findSlugCollision, isValidLearningSlug, overwriteLearningDocument, renameLearning, slugFromSummary } from "./store.js";

function fallbackSummaryFromPath(path: string): string {
	return basename(path, ".md").replace(/-/g, " ").trim() || "learning";
}

function targetDir(paths: LearningSystemPaths, scope: LearningScope, status: LearningStatus): string {
	if (scope === "global") return status === "pending" ? paths.globalPendingDir : paths.globalDir;
	return status === "pending" ? paths.projectPendingDir : paths.projectDir;
}

function normalizedFilenamePath(path: string, summary: string): string {
	const slug = basename(path, ".md");
	if (isValidLearningSlug(slug)) return path;
	return join(dirname(path), `${slugFromSummary(summary)}.md`);
}

function normalizeFrontmatter(
	frontmatter: Record<string, string>,
	summary: string,
	status: LearningStatus,
	reviewedAt = todayIso(),
): ApprovedLearningFrontmatter | PendingLearningFrontmatter {
	const normalizedReviewedAt = normalizeIsoDate(reviewedAt, todayIso());
	const created = normalizeIsoDate(collapseWhitespace(frontmatter.created ?? normalizedReviewedAt) || normalizedReviewedAt, normalizedReviewedAt);
	if (status === "approved") {
		return {
			created,
			lastReviewed: normalizedReviewedAt,
			summary,
		};
	}
	return {
		created,
		summary,
	};
}

export function sortExistingLearningsForReview<T extends ApprovedLearningFrontmatter>(documents: LearningDocument<T>[]): LearningDocument<T>[] {
	return [...documents].sort((a, b) => a.frontmatter.lastReviewed.localeCompare(b.frontmatter.lastReviewed) || a.filename.localeCompare(b.filename));
}

function mergeSectionValues(values: Array<string | undefined>): string | undefined {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const value of values) {
		if (!value) continue;
		for (const chunk of value.split(/\n\s*\n/)) {
			const trimmed = chunk.trim();
			if (!trimmed) continue;
			const dedupeKey = trimmed.replace(/\s+/g, " ").toLowerCase();
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			merged.push(trimmed);
		}
	}
	return merged.length > 0 ? merged.join("\n\n") : undefined;
}

export function mergeLearningDocuments(
	primary: LearningDocument<ApprovedLearningFrontmatter>,
	secondary: LearningDocument<ApprovedLearningFrontmatter>,
	reviewedAt = todayIso(),
): LearningDocument<ApprovedLearningFrontmatter> {
	const primarySections = parseLearningSections(primary.body);
	const secondarySections = parseLearningSections(secondary.body);
	const mergedSummary =
		secondary.frontmatter.summary.length > primary.frontmatter.summary.length
			? secondary.frontmatter.summary
			: primary.frontmatter.summary;
	const mergedBody = renderLearningBody({
		why: mergeSectionValues([primarySections.why, secondarySections.why]) ?? `This learning matters because ${mergedSummary.charAt(0).toLowerCase()}${mergedSummary.slice(1)}`,
		whenToApply: mergeSectionValues([primarySections.whenToApply, secondarySections.whenToApply]) ?? "Apply this when the same pattern appears again.",
		whenNotToApply: mergeSectionValues([primarySections.whenNotToApply, secondarySections.whenNotToApply]),
		details: mergeSectionValues([primarySections.details, secondarySections.details]),
	});
	return {
		...primary,
		frontmatter: {
			created: primary.frontmatter.created.localeCompare(secondary.frontmatter.created) <= 0 ? primary.frontmatter.created : secondary.frontmatter.created,
			lastReviewed: reviewedAt,
			summary: mergedSummary,
		},
		body: mergedBody,
	};
}

export async function buildNormalizedLearningDocument(
	path: string,
	scope: LearningScope,
	status: LearningStatus,
	reviewedAt = todayIso(),
): Promise<LearningDocument> {
	const raw = await readOptionalText(path);
	if (raw === undefined) throw new Error(`Learning not found: ${path}`);
	const { frontmatter, body: rawBody } = splitFrontmatter(raw);
	const summary = collapseWhitespace(frontmatter.summary ?? fallbackSummaryFromPath(path)) || "learning";
	const normalizedBody = ensureStructuredLearningBody(rawBody, summary);
	const normalizedFrontmatter = normalizeFrontmatter(frontmatter, summary, status, reviewedAt);
	return {
		path,
		filename: basename(path),
		scope,
		status,
		frontmatter: normalizedFrontmatter,
		rawFrontmatter: frontmatter,
		body: normalizedBody,
	};
}

export async function detectNormalizationIssues(path: string, scope: LearningScope, status: "approved" | "pending"): Promise<NormalizationIssue[]> {
	const raw = await readOptionalText(path);
	if (raw === undefined) return [];
	const { frontmatter, body: rawBody } = splitFrontmatter(raw);
	const summary = collapseWhitespace(frontmatter.summary ?? fallbackSummaryFromPath(path)) || "learning";
	const issues: NormalizationIssue[] = [];
	const expectedPath = normalizedFilenamePath(path, summary);
	if (expectedPath !== path) {
		issues.push({
			path,
			type: "filename",
			reason: "Filename must be a valid 1–5 word lowercase hyphenated slug.",
			proposedValue: expectedPath,
		});
	}
	const body = ensureStructuredLearningBody(rawBody, summary);
	if (!hasStructuredBody(rawBody) || rawBody.trim() !== body.trim()) {
		issues.push({
			path,
			type: "body",
			reason: "Learning body should keep the structured template with normalized section content.",
			proposedValue: body,
		});
	}
	const normalizedDocument = await buildNormalizedLearningDocument(path, scope, status);
	const allowedKeys = status === "approved" ? ["created", "lastReviewed", "summary"] : ["created", "summary"];
	const rawKeys = Object.keys(frontmatter).sort();
	const normalizedKeys = allowedKeys.slice().sort();
	const rawSummary = collapseWhitespace(frontmatter.summary ?? "");
	const normalizedSummary = normalizedDocument.frontmatter.summary;
	const rawCreated = collapseWhitespace(frontmatter.created ?? "");
	const normalizedCreated = normalizedDocument.frontmatter.created;
	const rawLastReviewed = status === "approved" ? collapseWhitespace(frontmatter.lastReviewed ?? "") : undefined;
	const hasValidApprovedLastReviewed = status !== "approved" || isRealIsoDate(rawLastReviewed);
	if (
		JSON.stringify(rawKeys) !== JSON.stringify(normalizedKeys)
		|| rawKeys.some((key) => frontmatter[key] === undefined)
		|| rawSummary !== normalizedSummary
		|| rawCreated !== normalizedCreated
		|| !hasValidApprovedLastReviewed
	) {
		issues.push({
			path,
			type: "frontmatter",
			reason: `Frontmatter must contain exactly: ${allowedKeys.join(", ")}.`,
			proposedValue: renderFrontmatter(normalizedDocument.frontmatter as Record<string, string>, allowedKeys),
		});
	}
	return issues;
}

export async function applyLearningNormalization(
	paths: LearningSystemPaths,
	input: { path: string; scope: LearningScope; status: LearningStatus; reviewedAt?: string },
): Promise<{
	path: string;
	normalizedPath: string;
	renamed: boolean;
	issues: NormalizationIssue[];
	collisionPath?: string;
	collisionFilename?: string;
}> {
	const issues = await detectNormalizationIssues(input.path, input.scope, input.status);
	const normalized = await buildNormalizedLearningDocument(input.path, input.scope, input.status, input.reviewedAt ?? todayIso());
	await overwriteLearningDocument(normalized);
	const expectedPath = normalizedFilenamePath(input.path, normalized.frontmatter.summary);
	if (expectedPath === input.path) {
		return {
			path: input.path,
			normalizedPath: input.path,
			renamed: false,
			issues,
		};
	}

	const expectedSlug = basename(expectedPath, ".md");
	const collision = await findSlugCollision(
		paths,
		expectedSlug,
		input.scope,
		[{ dir: targetDir(paths, input.scope, input.status), status: input.status }],
		input.path,
	);
	if (collision) {
		return {
			path: input.path,
			normalizedPath: input.path,
			renamed: false,
			issues,
			collisionPath: collision.path,
			collisionFilename: collision.filename,
		};
	}

	await renameLearning(input.path, expectedPath);
	return {
		path: input.path,
		normalizedPath: expectedPath,
		renamed: true,
		issues,
	};
}
