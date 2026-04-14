import type { MemorySnippet, SourcePathMeta, WorkingMemorySummary } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import { compactLines, extractBullets, firstParagraph, parseMarkdownSections, readOptionalText } from "./markdown.js";

function extractMetadata(body: string, label: string): string | undefined {
	const matcher = new RegExp(`^-\\s+\\*\\*${label}\\*\\*:\\s+(.+)$`, "m");
	const match = matcher.exec(body);
	return match?.[1]?.trim();
}

function sectionBullets(sections: Map<string, string[]>, headings: string[], maxItems = 4): string[] {
	const collected: string[] = [];
	for (const heading of headings) {
		collected.push(...extractBullets(sections.get(heading)));
	}
	return compactLines(collected, maxItems);
}

export async function loadWorkingMemorySummary(source: SourcePathMeta): Promise<WorkingMemorySummary | undefined> {
	const raw = await readOptionalText(source.sourcePath);
	if (!raw) return undefined;

	const sections = parseMarkdownSections(raw);
	const objective = firstParagraph(sections.get("objective"));
	const currentState = firstParagraph(sections.get("current state"));
	const nextRestartStep = firstParagraph(sections.get("next restart step"));
	const decisions = extractBullets(sections.get("decisions & rationale")).slice(0, 4);
	const openQuestions = extractBullets(sections.get("open questions / blockers")).slice(0, 4);
	const reviewFindings = sectionBullets(sections, ["review findings", "latest review findings"], 4);
	const changedFiles = sectionBullets(sections, ["changed files", "key changed files", "relevant files"], 8);

	return {
		source: { ...source, exists: true },
		slug: extractMetadata(raw, "Slug"),
		status: extractMetadata(raw, "Status"),
		objective,
		currentState,
		nextRestartStep,
		decisions,
		openQuestions,
		reviewFindings,
		changedFiles,
		estimatedTokens: estimateTokens(
			[
				objective,
				currentState,
				nextRestartStep,
				decisions.join("\n"),
				openQuestions.join("\n"),
				reviewFindings.join("\n"),
				changedFiles.join("\n"),
			]
				.filter(Boolean)
				.join("\n"),
		),
	};
}

export function workingMemoryToSnippet(summary: WorkingMemorySummary, priority: number): MemorySnippet {
	const lines: string[] = [];
	if (summary.slug) lines.push(`- slug: ${summary.slug}`);
	if (summary.status) lines.push(`- status: ${summary.status}`);
	if (summary.objective) lines.push(`- objective: ${summary.objective}`);
	if (summary.currentState) lines.push(`- current-state: ${summary.currentState}`);
	if (summary.nextRestartStep) lines.push(`- next-restart-step: ${summary.nextRestartStep}`);
	for (const decision of summary.decisions) {
		lines.push(`- decision: ${decision}`);
	}
	for (const question of summary.openQuestions) {
		lines.push(`- open-question: ${question}`);
	}
	for (const finding of summary.reviewFindings) {
		lines.push(`- review-finding: ${finding}`);
	}
	for (const file of summary.changedFiles) {
		lines.push(`- changed-file: ${file}`);
	}
	const rendered = lines.join("\n");
	return {
		...summary.source,
		title: "Current Work",
		summary: rendered,
		estimatedTokens: estimateTokens(rendered),
		priority,
		requiresValidation: true,
		validationReason: "Working-memory notes are hints and must be validated against the live workspace.",
		dedupeKey: normalizeForDedupe(rendered),
	};
}
