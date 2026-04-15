import { basename, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import type {
	ApprovedLearningFrontmatter,
	LearningDocument,
	LearningInjection,
	LearningScope,
	LearningStatus,
	LearningSystemPaths,
	PendingLearningCandidate,
} from "./contracts.js";
import { normalizeIsoDate, todayIso } from "./contracts.js";
import { buildLearningInjection } from "./inject.js";
import { ensureStructuredLearningBody } from "./markdown.js";
import {
	ensureLearningsDirs,
	requireManagedAgentsPath,
	requireManagedLearningPath,
	resolveLearningSystemPaths,
} from "./paths.js";
import { applyPromotionPlacement, loadPromotionPreview } from "./promotion.js";
import {
	applyLearningNormalization,
	detectNormalizationIssues,
	mergeLearningDocuments,
	recommendExistingAction,
	recommendPendingAction,
	sortExistingLearningsForReview,
} from "./review.js";
import { listAllLearningFiles, scanApprovedLearnings } from "./scan.js";
import {
	approvePendingLearning,
	deleteLearning,
	moveApprovedLearning,
	overwriteLearningDocument,
	readNormalizedLearningDocument,
	touchReviewedLearning,
	writePendingLearning,
} from "./store.js";

export interface LearningRuntimeSnapshot {
	paths: LearningSystemPaths;
	injection: LearningInjection;
}

interface ReviewablePendingItem {
	path: string;
	filename: string;
	scope: LearningScope;
	status: "pending";
	summary: string;
	body: string;
	recommendation: string;
}

interface ReviewableExistingItem {
	path: string;
	filename: string;
	scope: LearningScope;
	status: "approved";
	summary: string;
	body: string;
	lastReviewed: string;
	recommendation: string;
}

interface NormalizationReviewItem {
	path: string;
	filename: string;
	scope: LearningScope;
	status: LearningStatus;
	issues: Awaited<ReturnType<typeof detectNormalizationIssues>>;
}

export interface LearningReviewQueue {
	paths: LearningSystemPaths;
	pending: ReviewablePendingItem[];
	existing: ReviewableExistingItem[];
	normalization: NormalizationReviewItem[];
}

function requireText(value: string | undefined, label: string): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`Missing required parameter: ${label}`);
	return trimmed;
}

function resolveToolPath(cwd: string, path: string): string {
	const normalized = path.startsWith("@") ? path.slice(1) : path;
	return resolve(cwd, normalized);
}

function requireResolvedToolPath(cwd: string, value: string | undefined, label: string): string {
	return resolveToolPath(cwd, requireText(value, label));
}

function projectTargetPath(paths: LearningSystemPaths, target: LearningScope): string {
	return target === "global" ? paths.globalAgentsPath : paths.projectAgentsPath;
}

function toApprovedDocument(document: LearningDocument, reviewedAt = todayIso()): LearningDocument<ApprovedLearningFrontmatter> {
	if (document.status === "approved") return document as LearningDocument<ApprovedLearningFrontmatter>;
	return {
		...document,
		status: "approved",
		frontmatter: {
			created: document.frontmatter.created,
			lastReviewed: reviewedAt,
			summary: document.frontmatter.summary,
		},
	};
}

function describeNormalizationIssue(item: NormalizationReviewItem): string {
	const reasons = item.issues.map((issue) => `${issue.type}: ${issue.reason}`).join("; ");
	return `- ${item.scope} ${item.path} — ${reasons}`;
}

function buildCandidateDocument(
	path: string,
	scope: LearningScope,
	status: LearningStatus,
	candidate: PendingLearningCandidate,
	reviewedAt = todayIso(),
): LearningDocument {
	const normalizedReviewedAt = normalizeIsoDate(reviewedAt, todayIso());
	const created = normalizeIsoDate(candidate.created, normalizedReviewedAt);
	const body = ensureStructuredLearningBody(candidate.body, candidate.summary);
	if (status === "approved") {
		return {
			path,
			filename: basename(path),
			scope,
			status: "approved",
			frontmatter: {
				created,
				lastReviewed: normalizedReviewedAt,
				summary: candidate.summary,
			},
			rawFrontmatter: {},
			body,
		};
	}
	return {
		path,
		filename: basename(path),
		scope,
		status: "pending",
		frontmatter: {
			created,
			summary: candidate.summary,
		},
		rawFrontmatter: {},
		body,
	};
}

export async function refreshRuntimeState(cwd: string, options: { initializeDirs?: boolean } = {}): Promise<LearningRuntimeSnapshot> {
	const paths = await resolveLearningSystemPaths(cwd);
	if (options.initializeDirs) await ensureLearningsDirs(paths);
	const approved = await scanApprovedLearnings(paths);
	return {
		paths,
		injection: buildLearningInjection(approved),
	};
}

export async function initializeLearningSystemRuntime(cwd: string): Promise<LearningRuntimeSnapshot> {
	return refreshRuntimeState(cwd, { initializeDirs: true });
}

export async function createPendingLearningRuntime(cwd: string, candidate: PendingLearningCandidate) {
	const { paths } = await initializeLearningSystemRuntime(cwd);
	return writePendingLearning(paths, candidate);
}

export async function loadLearningReviewQueue(cwd: string): Promise<LearningReviewQueue> {
	const { paths } = await refreshRuntimeState(cwd);
	const allFiles = await listAllLearningFiles(paths);
	const pendingDocuments = await Promise.all(
		allFiles
			.filter((learning) => learning.status === "pending")
			.map((learning) => readNormalizedLearningDocument(learning.path, learning.scope, "pending", { preserveLastReviewed: true })),
	);
	const existingDocuments = sortExistingLearningsForReview(
		await Promise.all(
			allFiles
				.filter((learning) => learning.status === "approved")
				.map((learning) => readNormalizedLearningDocument(learning.path, learning.scope, "approved", { preserveLastReviewed: true })),
		),
	);
	const normalizationCandidates: NormalizationReviewItem[] = [];
	for (const learning of allFiles) {
		const issues = await detectNormalizationIssues(learning.path, learning.scope, learning.status);
		if (issues.length > 0) {
			normalizationCandidates.push({
				path: learning.path,
				filename: learning.path.split(/[/\\]/).pop() ?? learning.path,
				scope: learning.scope,
				status: learning.status,
				issues,
			});
		}
	}
	return {
		paths,
		pending: pendingDocuments.map((document) => ({
			path: document.path,
			filename: document.filename,
			scope: document.scope,
			status: "pending",
			summary: document.frontmatter.summary,
			body: document.body,
			recommendation: recommendPendingAction(document),
		})),
		existing: existingDocuments.map((document) => ({
			path: document.path,
			filename: document.filename,
			scope: document.scope,
			status: "approved",
			summary: document.frontmatter.summary,
			body: document.body,
			lastReviewed: document.frontmatter.lastReviewed,
			recommendation: recommendExistingAction(document),
		})),
		normalization: normalizationCandidates,
	};
}

export async function loadLearningPromotionPreviewRuntime(
	cwd: string,
	input: {
		path: string;
		scope: LearningScope;
		status: LearningStatus;
		target: LearningScope;
		reviewedAt?: string;
		sectionHeading?: string;
		compactedText?: string;
	},
) {
	const { paths } = await refreshRuntimeState(cwd);
	const learningPath = await requireManagedLearningPath(paths, input.path, {
		scope: input.scope,
		status: input.status,
	});
	const targetPath = await requireManagedAgentsPath(paths, projectTargetPath(paths, input.target), input.target);
	const document = await readNormalizedLearningDocument(learningPath, input.scope, input.status as "approved" | "pending", {
		reviewedAt: input.reviewedAt,
		preserveLastReviewed: true,
	});
	const approvedDocument = toApprovedDocument(document, input.reviewedAt ?? todayIso());
	return loadPromotionPreview(approvedDocument, targetPath, {
		sectionHeading: input.sectionHeading,
		compactedText: input.compactedText,
	});
}

export async function resolvePendingLearningCollisionRuntime(
	cwd: string,
	input: {
		action: "merge" | "replace" | "skip";
		collisionPath: string;
		collisionScope: LearningScope;
		collisionStatus: LearningStatus;
		candidate: PendingLearningCandidate;
		reviewedAt?: string;
	},
): Promise<{ status: "ok"; message: string; changedPaths: string[]; deletedPaths: string[] }> {
	if (input.action === "skip") {
		return {
			status: "ok",
			message: `Skipped collided candidate for ${input.collisionPath}`,
			changedPaths: [],
			deletedPaths: [],
		};
	}

	const { paths } = await refreshRuntimeState(cwd);
	const reviewedAt = input.reviewedAt ?? todayIso();
	const collisionPath = await requireManagedLearningPath(paths, input.collisionPath, {
		scope: input.collisionScope,
		status: input.collisionStatus,
	});
	const existing = await readNormalizedLearningDocument(
		collisionPath,
		input.collisionScope,
		input.collisionStatus as "approved" | "pending",
		{ reviewedAt, preserveLastReviewed: true },
	);
	const candidate = buildCandidateDocument(collisionPath, input.collisionScope, input.collisionStatus, input.candidate, reviewedAt);
	if (input.action === "replace") {
		if (existing.status === "approved") {
			await overwriteLearningDocument({
				...existing,
				frontmatter: {
					created: existing.frontmatter.created,
					lastReviewed: reviewedAt,
					summary: input.candidate.summary,
				},
				body: candidate.body,
			});
		} else {
			await overwriteLearningDocument({
				...existing,
				frontmatter: {
					created: existing.frontmatter.created,
					summary: input.candidate.summary,
				},
				body: candidate.body,
			});
		}
		return {
			status: "ok",
			message: `Replaced collided learning at ${collisionPath}`,
			changedPaths: [collisionPath],
			deletedPaths: [],
		};
	}

	const merged = mergeLearningDocuments(toApprovedDocument(existing, reviewedAt), toApprovedDocument(candidate, reviewedAt), reviewedAt);
	if (existing.status === "approved") {
		await overwriteLearningDocument({
			...existing,
			frontmatter: {
				created: existing.frontmatter.created,
				lastReviewed: reviewedAt,
				summary: merged.frontmatter.summary,
			},
			body: merged.body,
		});
	} else {
		await overwriteLearningDocument({
			...existing,
			frontmatter: {
				created: existing.frontmatter.created,
				summary: merged.frontmatter.summary,
			},
			body: merged.body,
		});
	}
	return {
		status: "ok",
		message: `Merged collided candidate into ${collisionPath}`,
		changedPaths: [collisionPath],
		deletedPaths: [],
	};
}

export async function resolveReviewCollisionRuntime(
	cwd: string,
	input: {
		action: "merge" | "replace" | "skip" | "keep_current_filename";
		sourcePath: string;
		sourceScope: LearningScope;
		sourceStatus: LearningStatus;
		collisionPath: string;
		collisionScope: LearningScope;
		collisionStatus: LearningStatus;
		deleteSourceOnResolved?: boolean;
		reviewedAt?: string;
	},
): Promise<{ status: "ok"; message: string; changedPaths: string[]; deletedPaths: string[] }> {
	if (input.action === "skip") {
		return {
			status: "ok",
			message: `Skipped review-time collision for ${input.sourcePath}`,
			changedPaths: [],
			deletedPaths: [],
		};
	}
	if (input.action === "keep_current_filename") {
		return {
			status: "ok",
			message: `Kept current filename for ${input.sourcePath}`,
			changedPaths: [],
			deletedPaths: [],
		};
	}

	const { paths } = await refreshRuntimeState(cwd);
	const sourcePath = await requireManagedLearningPath(paths, input.sourcePath, {
		scope: input.sourceScope,
		status: input.sourceStatus,
	});
	const collisionPath = await requireManagedLearningPath(paths, input.collisionPath, {
		scope: input.collisionScope,
		status: input.collisionStatus,
	});
	const source = await readNormalizedLearningDocument(sourcePath, input.sourceScope, input.sourceStatus as "approved" | "pending", {
		reviewedAt: input.reviewedAt,
		preserveLastReviewed: true,
	});
	const resolution = await resolvePendingLearningCollisionRuntime(cwd, {
		action: input.action,
		collisionPath,
		collisionScope: input.collisionScope,
		collisionStatus: input.collisionStatus,
		candidate: {
			summary: source.frontmatter.summary,
			body: source.body,
			created: source.frontmatter.created,
		},
		reviewedAt: input.reviewedAt,
	});
	if (input.deleteSourceOnResolved && sourcePath !== collisionPath) {
		await deleteLearning(sourcePath);
		resolution.deletedPaths.push(sourcePath);
	}
	return resolution;
}

export async function applyLearningReviewActionRuntime(
	cwd: string,
	input:
		| { action: "approve_pending"; path: string; fromScope: LearningScope; toScope: LearningScope; reviewedAt?: string }
		| { action: "reject_pending" | "remove"; path: string }
		| { action: "keep"; path: string; scope: LearningScope; reviewedAt?: string }
		| { action: "move_to_scope"; path: string; fromScope: LearningScope; toScope: LearningScope; reviewedAt?: string }
		| { action: "consolidate"; primaryPath: string; primaryScope: LearningScope; secondaryPath: string; secondaryScope: LearningScope; reviewedAt?: string }
		| { action: "normalize"; path: string; scope: LearningScope; status: LearningStatus; reviewedAt?: string }
		| {
				action: "promote";
				path: string;
				scope: LearningScope;
				status: LearningStatus;
				target: LearningScope;
				reviewedAt?: string;
				sectionHeading?: string;
				compactedText?: string;
				confirmationToken?: string;
		  },
): Promise<{
	status: "ok" | "collision";
	message: string;
	changedPaths: string[];
	deletedPaths: string[];
	collisionPath?: string;
	collisionFilename?: string;
	placement?: Awaited<ReturnType<typeof loadLearningPromotionPreviewRuntime>>;
}> {
	if (input.action === "approve_pending") {
		const { paths } = await refreshRuntimeState(cwd, { initializeDirs: true });
		const sourcePath = await requireManagedLearningPath(paths, input.path, {
			scope: input.fromScope,
			status: "pending",
		});
		const result = await approvePendingLearning(paths, {
			path: sourcePath,
			fromScope: input.fromScope,
			toScope: input.toScope,
			reviewedAt: input.reviewedAt,
		});
		if (result.status === "collision") {
			return {
				status: "collision",
				message: `Collision while approving ${sourcePath}: ${result.collision?.path}`,
				changedPaths: [],
				deletedPaths: [],
				collisionPath: result.collision?.path,
				collisionFilename: result.collision?.filename,
			};
		}
		return {
			status: "ok",
			message: `Approved pending learning to ${result.path}`,
			changedPaths: result.path ? [result.path] : [],
			deletedPaths: [sourcePath],
		};
	}

	if (input.action === "reject_pending") {
		const { paths } = await refreshRuntimeState(cwd);
		const learningPath = await requireManagedLearningPath(paths, input.path, {
			status: "pending",
		});
		await deleteLearning(learningPath);
		return {
			status: "ok",
			message: `Rejected pending learning ${learningPath}`,
			changedPaths: [],
			deletedPaths: [learningPath],
		};
	}

	if (input.action === "remove") {
		const { paths } = await refreshRuntimeState(cwd);
		const learningPath = await requireManagedLearningPath(paths, input.path, {
			status: "approved",
		});
		await deleteLearning(learningPath);
		return {
			status: "ok",
			message: `Removed approved learning ${learningPath}`,
			changedPaths: [],
			deletedPaths: [learningPath],
		};
	}

	if (input.action === "keep") {
		const { paths } = await refreshRuntimeState(cwd);
		const learningPath = await requireManagedLearningPath(paths, input.path, {
			scope: input.scope,
			status: "approved",
		});
		await touchReviewedLearning(learningPath, input.scope, input.reviewedAt ?? todayIso());
		return {
			status: "ok",
			message: `Updated lastReviewed for ${learningPath}`,
			changedPaths: [learningPath],
			deletedPaths: [],
		};
	}

	if (input.action === "move_to_scope") {
		if (input.fromScope === input.toScope) {
			return {
				status: "ok",
				message: `Skipped move for ${input.path}: source and target scope are both ${input.fromScope}`,
				changedPaths: [],
				deletedPaths: [],
			};
		}
		const { paths } = await refreshRuntimeState(cwd, { initializeDirs: true });
		const sourcePath = await requireManagedLearningPath(paths, input.path, {
			scope: input.fromScope,
			status: "approved",
		});
		const result = await moveApprovedLearning(paths, {
			path: sourcePath,
			fromScope: input.fromScope,
			toScope: input.toScope,
			reviewedAt: input.reviewedAt,
		});
		if (result.status === "collision") {
			return {
				status: "collision",
				message: `Collision while moving ${sourcePath}: ${result.collision?.path}`,
				changedPaths: [],
				deletedPaths: [],
				collisionPath: result.collision?.path,
				collisionFilename: result.collision?.filename,
			};
		}
		return {
			status: "ok",
			message: `Moved learning to ${result.path}`,
			changedPaths: result.path ? [result.path] : [],
			deletedPaths: [sourcePath],
		};
	}

	if (input.action === "consolidate") {
		if (input.primaryPath === input.secondaryPath) {
			return {
				status: "ok",
				message: `Skipped consolidation for ${input.primaryPath}: source and target are the same learning`,
				changedPaths: [],
				deletedPaths: [],
			};
		}
		const { paths } = await refreshRuntimeState(cwd);
		const primaryPath = await requireManagedLearningPath(paths, input.primaryPath, {
			scope: input.primaryScope,
			status: "approved",
		});
		const secondaryPath = await requireManagedLearningPath(paths, input.secondaryPath, {
			scope: input.secondaryScope,
			status: "approved",
		});
		const primary = await readNormalizedLearningDocument(primaryPath, input.primaryScope, "approved", {
			reviewedAt: input.reviewedAt,
			preserveLastReviewed: true,
		});
		const secondary = await readNormalizedLearningDocument(secondaryPath, input.secondaryScope, "approved", {
			reviewedAt: input.reviewedAt,
			preserveLastReviewed: true,
		});
		const merged = mergeLearningDocuments(primary, secondary, input.reviewedAt ?? todayIso());
		await overwriteLearningDocument(merged);
		await deleteLearning(secondaryPath);
		return {
			status: "ok",
			message: `Consolidated ${secondaryPath} into ${primaryPath}`,
			changedPaths: [primaryPath],
			deletedPaths: [secondaryPath],
		};
	}

	if (input.action === "normalize") {
		const { paths } = await refreshRuntimeState(cwd);
		const learningPath = await requireManagedLearningPath(paths, input.path, {
			scope: input.scope,
			status: input.status,
		});
		const result = await applyLearningNormalization(paths, {
			...input,
			path: learningPath,
		});
		if (result.collisionPath) {
			return {
				status: "collision",
				message: `Normalized content for ${learningPath}, but rename collided with ${result.collisionPath}`,
				changedPaths: [learningPath],
				deletedPaths: [],
				collisionPath: result.collisionPath,
				collisionFilename: result.collisionFilename,
			};
		}
		return {
			status: "ok",
			message:
				result.normalizedPath === learningPath
					? `Normalized ${learningPath}`
					: `Normalized ${learningPath} and renamed it to ${result.normalizedPath}`,
			changedPaths: [result.normalizedPath],
			deletedPaths: result.normalizedPath === learningPath ? [] : [learningPath],
		};
	}

	const { paths } = await refreshRuntimeState(cwd);
	const learningPath = await requireManagedLearningPath(paths, input.path, {
		scope: input.scope,
		status: input.status,
	});
	const targetPath = await requireManagedAgentsPath(paths, projectTargetPath(paths, input.target), input.target);
	const preview = await loadLearningPromotionPreviewRuntime(cwd, {
		...input,
		path: learningPath,
		target: input.target,
		sectionHeading: input.sectionHeading,
		compactedText: input.compactedText,
	});
	const confirmationToken = input.confirmationToken?.trim();
	if (!confirmationToken) {
		throw new Error("Promotion requires a confirmationToken from learning_promotion_preview after the user confirms the preview.");
	}
	if (confirmationToken !== preview.confirmationToken) {
		throw new Error(`Promotion confirmation token mismatch for ${learningPath}. Request a fresh learning_promotion_preview before promoting.`);
	}
	const wrote = await applyPromotionPlacement(preview);
	await deleteLearning(learningPath);
	return {
		status: "ok",
		message: wrote ? `Promoted ${learningPath} into ${targetPath}` : `Skipped duplicate promotion and deleted ${learningPath}`,
		changedPaths: wrote ? [targetPath] : [],
		deletedPaths: [learningPath],
		placement: preview,
	};
}

function formatReviewQueue(queue: LearningReviewQueue): string {
	const lines = [
		`Pending learnings: ${queue.pending.length}`,
		...queue.pending.map(
			(item, index) => `${index + 1}. [${item.scope}] ${item.path} — Recommended: ${item.recommendation}\n   Summary: ${item.summary}`,
		),
		`Existing learnings: ${queue.existing.length}`,
		...queue.existing.map(
			(item, index) =>
				`${index + 1}. [${item.scope}] ${item.path} — Recommended: ${item.recommendation} (lastReviewed: ${item.lastReviewed})\n   Summary: ${item.summary}`,
		),
		`Normalization items: ${queue.normalization.length}`,
		...queue.normalization.map(describeNormalizationIssue),
	];
	return lines.join("\n");
}

const ScopeSchema = StringEnum(["project", "global"] as const, {
	description: "Learning scope.",
});
const StatusSchema = StringEnum(["pending", "approved"] as const, {
	description: "Learning status.",
});
const ReviewActionSchema = StringEnum([
	"approve_pending",
	"reject_pending",
	"keep",
	"move_to_scope",
	"promote",
	"remove",
	"consolidate",
	"normalize",
] as const, {
	description: "Review action to apply.",
});

const WritePendingParams = Type.Object({
	summary: Type.String({ description: "One-sentence learning summary." }),
	body: Type.String({ description: "Markdown learning body." }),
	scope: Type.Optional(ScopeSchema),
	created: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic tests." })),
});

const CollisionActionSchema = StringEnum(["merge", "replace", "skip"] as const, {
	description: "How to resolve a pending-creation slug collision.",
});

const ResolvePendingCollisionParams = Type.Object({
	action: CollisionActionSchema,
	collisionPath: Type.String({ description: "Existing pending/approved file path reported by learning_write_pending." }),
	collisionScope: ScopeSchema,
	collisionStatus: StringEnum(["pending", "approved"] as const, { description: "Status of the collided file." }),
	summary: Type.String({ description: "Candidate learning summary." }),
	body: Type.String({ description: "Candidate learning body." }),
	created: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic tests." })),
	reviewedAt: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic tests." })),
});

const ReviewCollisionActionSchema = StringEnum(["merge", "replace", "skip", "keep_current_filename"] as const, {
	description: "How to resolve a review-time collision after learning_apply_review_action returns status=collision.",
});

const ResolveReviewCollisionParams = Type.Object({
	action: ReviewCollisionActionSchema,
	sourcePath: Type.String({ description: "Path to the source learning that triggered the collision." }),
	sourceScope: ScopeSchema,
	sourceStatus: StringEnum(["pending", "approved"] as const, { description: "Status of the source learning." }),
	collisionPath: Type.String({ description: "Conflicting learning path returned by learning_apply_review_action." }),
	collisionScope: ScopeSchema,
	collisionStatus: StringEnum(["pending", "approved"] as const, { description: "Status of the conflicting learning." }),
	deleteSourceOnResolved: Type.Optional(Type.Boolean({ description: "Delete the source learning after merge/replace resolves the collision." })),
	reviewedAt: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic tests." })),
});

const PromotionPreviewParams = Type.Object({
	path: Type.String({ description: "Path to the learning file." }),
	scope: ScopeSchema,
	status: StatusSchema,
	target: ScopeSchema,
	reviewedAt: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic previews." })),
	sectionHeading: Type.Optional(Type.String({ description: "Optional AGENTS.md section override to preview before promotion." })),
	compactedText: Type.Optional(Type.String({ description: "Optional compacted AGENTS.md text override to preview before promotion." })),
});

const ApplyReviewActionParams = Type.Object({
	action: ReviewActionSchema,
	path: Type.Optional(Type.String({ description: "Primary learning path for most actions." })),
	fromScope: Type.Optional(ScopeSchema),
	toScope: Type.Optional(ScopeSchema),
	scope: Type.Optional(ScopeSchema),
	status: Type.Optional(StatusSchema),
	target: Type.Optional(ScopeSchema),
	reviewedAt: Type.Optional(Type.String({ description: "Optional YYYY-MM-DD override for deterministic tests." })),
	primaryPath: Type.Optional(Type.String({ description: "Primary learning path for consolidation." })),
	primaryScope: Type.Optional(ScopeSchema),
	secondaryPath: Type.Optional(Type.String({ description: "Secondary learning path for consolidation." })),
	secondaryScope: Type.Optional(ScopeSchema),
	sectionHeading: Type.Optional(Type.String({ description: "Optional AGENTS.md section override for promotion." })),
	compactedText: Type.Optional(Type.String({ description: "Optional compacted AGENTS.md text override for promotion." })),
	confirmationToken: Type.Optional(Type.String({ description: "Confirmation token returned by learning_promotion_preview after the user approves the promotion." })),
});

export function registerLearningRuntimeTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "learning_write_pending",
		label: "Learning Write Pending",
		description: "Create a pending learning file using the live learning-system storage, slugging, and collision rules.",
		promptSnippet: "Create a pending learning file via the live learning-system runtime.",
		promptGuidelines: ["Use this instead of direct file writes when creating pending learnings during /learn."],
		parameters: WritePendingParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await createPendingLearningRuntime(ctx.cwd, params);
			if (result.status === "collision") {
				return {
					content: [
						{ type: "text", text: `Pending learning collision: ${result.collision?.path}\nCanonical filename: ${result.filename}` },
					],
					details: result,
				};
			}
			return {
				content: [{ type: "text", text: `Created pending learning: ${result.path}` }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "learning_resolve_pending_collision",
		label: "Learning Resolve Pending Collision",
		description: "Resolve a pending-learning creation collision by merging into, replacing, or skipping the existing file through the live runtime.",
		promptSnippet: "Resolve a pending-learning slug collision via the live learning-system runtime.",
		promptGuidelines: ["Use this after learning_write_pending reports a collision and the user chooses merge, replace, or skip."],
		parameters: ResolvePendingCollisionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await resolvePendingLearningCollisionRuntime(ctx.cwd, {
				action: params.action,
				collisionPath: requireResolvedToolPath(ctx.cwd, params.collisionPath, "collisionPath"),
				collisionScope: params.collisionScope,
				collisionStatus: params.collisionStatus,
				candidate: {
					summary: params.summary,
					body: params.body,
					created: params.created,
				},
				reviewedAt: params.reviewedAt,
			});
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "learning_resolve_review_collision",
		label: "Learning Resolve Review Collision",
		description: "Resolve a review-time collision surfaced by learning_apply_review_action by merging, replacing, skipping, or keeping the current filename.",
		promptSnippet: "Resolve a review-time learning collision through the live runtime.",
		promptGuidelines: ["Use this when learning_apply_review_action returns status=collision during /learn review."],
		parameters: ResolveReviewCollisionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await resolveReviewCollisionRuntime(ctx.cwd, {
				action: params.action,
				sourcePath: requireResolvedToolPath(ctx.cwd, params.sourcePath, "sourcePath"),
				sourceScope: params.sourceScope,
				sourceStatus: params.sourceStatus,
				collisionPath: requireResolvedToolPath(ctx.cwd, params.collisionPath, "collisionPath"),
				collisionScope: params.collisionScope,
				collisionStatus: params.collisionStatus,
				deleteSourceOnResolved: params.deleteSourceOnResolved,
				reviewedAt: params.reviewedAt,
			});
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "learning_review_queue",
		label: "Learning Review Queue",
		description: "Inspect pending and approved learnings in live storage, including recommendations and normalization proposals.",
		promptSnippet: "Inspect the live /learn review queue with recommendations and normalization proposals.",
		promptGuidelines: ["Use this at the start of /learn review instead of ad-hoc directory scanning."],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const queue = await loadLearningReviewQueue(ctx.cwd);
			return {
				content: [{ type: "text", text: formatReviewQueue(queue) }],
				details: queue,
			};
		},
	});

	pi.registerTool({
		name: "learning_promotion_preview",
		label: "Learning Promotion Preview",
		description: "Build the live AGENTS.md promotion preview for a learning, including compacted text and target section.",
		promptSnippet: "Preview a learning promotion into AGENTS.md before asking for confirmation.",
		promptGuidelines: ["Use this before every AGENTS.md promotion questionnaire in /learn review."],
		parameters: PromotionPreviewParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const learningPath = requireResolvedToolPath(ctx.cwd, params.path, "path");
			const preview = await loadLearningPromotionPreviewRuntime(ctx.cwd, {
				...params,
				path: learningPath,
			});
			return {
				content: [
					{
						type: "text",
						text: [
							`Promotion preview for ${learningPath}`,
							`Target: ${preview.targetPath}`,
							`Section: ${preview.sectionHeading}`,
							`Already present: ${preview.alreadyPresent ? "yes" : "no"}`,
							`Confirmation token: ${preview.confirmationToken}`,
							`Text: ${preview.compactedText}`,
						].join("\n"),
					},
				],
				details: preview,
			};
		},
	});

	pi.registerTool({
		name: "learning_apply_review_action",
		label: "Learning Apply Review Action",
		description: "Apply a reviewed learning action using the live store, review, normalization, consolidation, and promotion helpers.",
		promptSnippet: "Apply a /learn review decision through the live learning-system runtime.",
		promptGuidelines: ["Use this after questionnaire decisions instead of manual file edits during /learn review."],
		parameters: ApplyReviewActionParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await applyLearningReviewActionRuntime(
				ctx.cwd,
				params.action === "approve_pending"
					? {
							action: "approve_pending",
							path: requireResolvedToolPath(ctx.cwd, params.path, "path"),
							fromScope: params.fromScope ?? params.scope ?? "project",
							toScope: params.toScope ?? "project",
							reviewedAt: params.reviewedAt,
						}
					: params.action === "reject_pending"
						? { action: "reject_pending", path: requireResolvedToolPath(ctx.cwd, params.path, "path") }
						: params.action === "keep"
							? {
									action: "keep",
									path: requireResolvedToolPath(ctx.cwd, params.path, "path"),
									scope: params.scope ?? params.fromScope ?? "project",
									reviewedAt: params.reviewedAt,
							  }
							: params.action === "move_to_scope"
								? {
										action: "move_to_scope",
										path: requireResolvedToolPath(ctx.cwd, params.path, "path"),
										fromScope: params.fromScope ?? params.scope ?? "project",
										toScope: params.toScope ?? "global",
										reviewedAt: params.reviewedAt,
								  }
								: params.action === "promote"
									? {
											action: "promote",
											path: requireResolvedToolPath(ctx.cwd, params.path, "path"),
											scope: params.scope ?? params.fromScope ?? "project",
											status: params.status ?? "approved",
											target: params.target ?? "project",
											reviewedAt: params.reviewedAt,
											sectionHeading: params.sectionHeading,
											compactedText: params.compactedText,
											confirmationToken: params.confirmationToken,
									  }
									: params.action === "remove"
										? { action: "remove", path: requireResolvedToolPath(ctx.cwd, params.path, "path") }
										: params.action === "consolidate"
											? {
													action: "consolidate",
													primaryPath: requireResolvedToolPath(ctx.cwd, params.primaryPath ?? params.path, "primaryPath"),
													primaryScope: params.primaryScope ?? params.scope ?? params.fromScope ?? "project",
													secondaryPath: requireResolvedToolPath(ctx.cwd, params.secondaryPath, "secondaryPath"),
													secondaryScope: params.secondaryScope ?? params.toScope ?? "project",
													reviewedAt: params.reviewedAt,
											  }
											: {
													action: "normalize",
													path: requireResolvedToolPath(ctx.cwd, params.path, "path"),
													scope: params.scope ?? params.fromScope ?? "project",
													status: params.status ?? "approved",
													reviewedAt: params.reviewedAt,
											  },
			);
			return {
				content: [{ type: "text", text: result.message }],
				details: result,
			};
		},
	});
}
