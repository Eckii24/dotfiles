import type { MemorySnippet, ProfileSummary, SourcePathMeta } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import { compactLines, extractBullets, firstParagraph, getMarkdownTitle, parseMarkdownSections, readOptionalText } from "./markdown.js";

const USER_PROFILE_PRIORITY_HEADINGS = ["stable preferences", "preferred workflow", "current tendencies", "avoid"];
const PROJECT_PROFILE_PRIORITY_HEADINGS = ["stack & architecture", "active focus", "constraints", "high-signal conventions"];

const AGENTS_STYLE_PATTERNS = [
	/\bquestionnaire\b/i,
	/\bsub-?agents?\b/i,
	/\bskills?\b/i,
	/\bsystem prompt\b/i,
	/\bAGENTS\.md\b/i,
	/\buse `read`\b/i,
	/\buse `bash`\b/i,
	/\buse `edit`\b/i,
	/\banchored in `\.ai\/current-work\.md`\b/i,
];

function isAgentsStyleInstruction(line: string): boolean {
	return AGENTS_STYLE_PATTERNS.some((pattern) => pattern.test(line));
}

function pickProfileHighlights(source: SourcePathMeta, raw: string): string[] {
	const sections = parseMarkdownSections(raw);
	const headings = source.kind === "user-profile" ? USER_PROFILE_PRIORITY_HEADINGS : PROJECT_PROFILE_PRIORITY_HEADINGS;
	const highlights: string[] = [];

	for (const heading of headings) {
		const lines = sections.get(heading);
		const bullets = extractBullets(lines)
			.map((bullet) => `${heading}: ${bullet}`)
			.filter((bullet) => !isAgentsStyleInstruction(bullet));
		for (const bullet of bullets) highlights.push(bullet);
		const paragraph = firstParagraph(lines);
		if (paragraph) {
			const candidate = `${heading}: ${paragraph}`;
			if (!isAgentsStyleInstruction(candidate)) highlights.push(candidate);
		}
	}

	return compactLines(highlights, 6);
}

export async function loadProfileSummary(source: SourcePathMeta, fallbackTitle: string): Promise<ProfileSummary | undefined> {
	const raw = await readOptionalText(source.sourcePath);
	if (!raw) return undefined;
	const title = getMarkdownTitle(raw, fallbackTitle);
	const highlights = pickProfileHighlights(source, raw);
	const summaryText = highlights.join("\n");
	return {
		source: { ...source, exists: true },
		title,
		highlights,
		estimatedTokens: estimateTokens(summaryText),
	};
}

export function profileSummaryToSnippet(summary: ProfileSummary, priority: number): MemorySnippet {
	const summaryLines = summary.highlights.map((highlight) => `- ${highlight}`).join("\n");
	const requiresValidation = summary.source.kind !== "user-profile";
	return {
		...summary.source,
		title: summary.title,
		summary: summaryLines,
		estimatedTokens: estimateTokens(summaryLines),
		priority,
		requiresValidation,
		validationReason: requiresValidation ? "Profile summaries may lag behind the live workspace." : undefined,
		dedupeKey: normalizeForDedupe(`${summary.source.kind}:${summary.highlights.join(" | ")}`),
	};
}
