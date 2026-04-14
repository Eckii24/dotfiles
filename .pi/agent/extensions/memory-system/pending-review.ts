export interface PendingReviewDispatchOptions {
	hasUI: boolean;
	reason: string;
	pendingLearningCount?: number;
	pendingMemoryProposalCount?: number;
	availableCommandNames: string[];
}

export interface LegacyPendingReviewDispatchOptions {
	hasUI: boolean;
	reason: string;
	pendingCount: number;
	availableCommandNames: string[];
}

export function shouldAutoDispatchPendingReview(options: PendingReviewDispatchOptions): boolean {
	if (!options.hasUI) return false;
	const total = (options.pendingLearningCount ?? 0) + (options.pendingMemoryProposalCount ?? 0);
	if (total <= 0) return false;
	if (options.reason === "reload") return false;
	return options.availableCommandNames.includes("learn");
}

export function shouldAutoDispatchPendingLearnings(options: LegacyPendingReviewDispatchOptions): boolean {
	return shouldAutoDispatchPendingReview({
		hasUI: options.hasUI,
		reason: options.reason,
		pendingLearningCount: options.pendingCount,
		availableCommandNames: options.availableCommandNames,
	});
}

export function buildPendingReviewPrompt(paths: string[]): string {
	return `/learn review ${paths.join(" ")}`;
}

export function buildPendingLearningsReviewPrompt(path: string): string {
	return buildPendingReviewPrompt([path]);
}
