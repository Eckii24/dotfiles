import { writeFile } from "node:fs/promises";
import type { ApprovedLearningFrontmatter, LearningDocument, PromotionPlacement } from "./contracts.js";
import { hashText, normalizeForDedupe } from "./contracts.js";
import { parseLearningSections, readOptionalText } from "./markdown.js";

interface HeadingMatch {
	level: number;
	title: string;
	start: number;
	end: number;
}

function parseHeadings(text: string): HeadingMatch[] {
	const matches: HeadingMatch[] = [];
	const regex = /^(#{1,6})\s+(.+)$/gm;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text))) {
		matches.push({
			level: match[1].length,
			title: match[2].trim(),
			start: match.index,
			end: regex.lastIndex,
		});
	}
	return matches;
}

function firstSentence(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const flattened = value
		.replace(/^[-*]\s+/gm, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!flattened) return undefined;
	const match = flattened.match(/.+?[.!?](?:\s|$)/);
	return (match?.[0] ?? flattened).trim().replace(/[.]+$/, "");
}

function lowerFirst(value: string): string {
	return value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
}

function normalizeConditionPhrase(prefix: string, value: string | undefined): string | undefined {
	const sentence = firstSentence(value);
	if (!sentence) return undefined;
	const normalized = lowerFirst(
		sentence
			.replace(/^(apply|use|keep|prefer|validate|delegate|review)\s+when\s+/i, "when ")
			.replace(/^(when|whenever|if)\s+/i, "")
			.replace(/^(the situations? where|situations? where|cases? where)\s+/i, "")
			.trim(),
	);
	return normalized ? `${prefix} ${normalized}` : undefined;
}

export function compactLearning(document: LearningDocument<ApprovedLearningFrontmatter>): string {
	const sections = parseLearningSections(document.body);
	const summary = document.frontmatter.summary.trim().replace(/[.]+$/, "");
	const apply = normalizeConditionPhrase("Apply when", sections.whenToApply);
	const avoid = normalizeConditionPhrase("Do not apply when", sections.whenNotToApply);
	const why = firstSentence(sections.why);
	const parts = [summary];
	if (apply) parts.push(apply);
	else if (why) parts.push(`Why: ${lowerFirst(why)}`);
	if (avoid) parts.push(avoid);
	return `${parts.join(". ")}.`.replace(/\.\./g, ".");
}

function chooseSectionHeading(document: LearningDocument<ApprovedLearningFrontmatter>, headings: HeadingMatch[]): string {
	const haystack = `${document.frontmatter.summary}\n${document.body}`.toLowerCase();
	const preferred = [
		{ heading: "Sub Agents", matches: ["sub-agent", "subagent", "delegate"] },
		{ heading: "Questions", matches: ["questionnaire", "question"] },
		{ heading: "Preferences", matches: ["prefer", "concise", "labels", "descriptions"] },
		{ heading: "Project Memory & Tracked Work", matches: ["current-work", "tracked work", "artifact", ".ai/"] },
	];
	for (const candidate of preferred) {
		if (!candidate.matches.some((term) => haystack.includes(term))) continue;
		const heading = headings.find((entry) => entry.title.toLowerCase() === candidate.heading.toLowerCase());
		if (heading) return heading.title;
	}
	return "Learnings";
}

export function buildPromotionConfirmationToken(input: {
	sourcePath: string;
	targetPath: string;
	sectionHeading: string;
	compactedText: string;
}): string {
	return `promotion:${hashText(JSON.stringify(input))}`;
}

export function buildPromotionPlacement(
	document: LearningDocument<ApprovedLearningFrontmatter>,
	targetPath: string,
	agentsText: string,
	overrides: { sectionHeading?: string; compactedText?: string } = {},
): PromotionPlacement {
	const headings = parseHeadings(agentsText);
	const compactedText = overrides.compactedText?.trim() || compactLearning(document);
	const sectionHeading = overrides.sectionHeading?.trim() || chooseSectionHeading(document, headings);
	const alreadyPresent = normalizeForDedupe(agentsText).includes(normalizeForDedupe(compactedText));
	return {
		targetPath,
		sectionHeading,
		compactedText,
		alreadyPresent,
		confirmationToken: buildPromotionConfirmationToken({
			sourcePath: document.path,
			targetPath,
			sectionHeading,
			compactedText,
		}),
	};
}

function insertBulletIntoSection(text: string, sectionHeading: string, bullet: string): string {
	const headings = parseHeadings(text);
	const targetIndex = headings.findIndex((heading) => heading.title.toLowerCase() === sectionHeading.toLowerCase());
	if (targetIndex === -1) {
		const prefix = text.trimEnd();
		return `${prefix}${prefix ? "\n\n" : ""}# ${sectionHeading}\n- ${bullet}\n`;
	}

	const target = headings[targetIndex];
	const next = headings.slice(targetIndex + 1).find((heading) => heading.level <= target.level);
	const sectionEnd = next?.start ?? text.length;
	const sectionBody = text.slice(target.end, sectionEnd).trimEnd();
	const bulletLine = `- ${bullet}`;
	if (sectionBody.includes(bulletLine)) return text;
	const before = text.slice(0, target.end);
	const after = text.slice(sectionEnd);
	const nextSection = sectionBody ? `${sectionBody}\n${bulletLine}` : `\n${bulletLine}`;
	return `${before}${nextSection}\n${after.replace(/^\n*/, "")}`;
}

export async function applyPromotionPlacement(placement: PromotionPlacement): Promise<boolean> {
	const existing = (await readOptionalText(placement.targetPath)) ?? "";
	const alreadyPresent = normalizeForDedupe(existing).includes(normalizeForDedupe(placement.compactedText));
	if (alreadyPresent) return false;
	const updated = insertBulletIntoSection(existing, placement.sectionHeading, placement.compactedText);
	await writeFile(placement.targetPath, updated, "utf8");
	return true;
}

export async function loadPromotionPreview(
	document: LearningDocument<ApprovedLearningFrontmatter>,
	targetPath: string,
	overrides: { sectionHeading?: string; compactedText?: string } = {},
): Promise<PromotionPlacement> {
	const agentsText = (await readOptionalText(targetPath)) ?? "";
	return buildPromotionPlacement(document, targetPath, agentsText, overrides);
}
