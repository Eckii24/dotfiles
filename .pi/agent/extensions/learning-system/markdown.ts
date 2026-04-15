import { readFile } from "node:fs/promises";
import type { LearningSections } from "./contracts.js";

const FRONTMATTER_BOUNDARY = "---";
const SECTION_TITLES = {
	why: "Why",
	whenToApply: "When to Apply",
	whenNotToApply: "When Not to Apply",
	details: "Details",
} as const;

export async function readOptionalText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		const candidate = error as NodeJS.ErrnoException;
		if (candidate.code === "ENOENT") return undefined;
		throw error;
	}
}

export function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

export function splitFrontmatter(text: string): {
	frontmatter: Record<string, string>;
	body: string;
	rawFrontmatter: string;
} {
	if (!text.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
		return { frontmatter: {}, body: text, rawFrontmatter: "" };
	}

	const lines = text.split(/\r?\n/);
	const closingIndex = lines.findIndex((line, index) => index > 0 && line === FRONTMATTER_BOUNDARY);
	if (closingIndex === -1) {
		return { frontmatter: {}, body: text, rawFrontmatter: "" };
	}

	const rawFrontmatter = lines.slice(1, closingIndex).join("\n");
	const frontmatter: Record<string, string> = {};
	for (const line of lines.slice(1, closingIndex)) {
		if (!line.trim()) continue;
		const match = /^([A-Za-z][A-Za-z0-9]*)\s*:\s*(.+)$/.exec(line);
		if (!match) continue;
		frontmatter[match[1]] = stripQuotes(match[2].trim());
	}

	return {
		frontmatter,
		body: lines.slice(closingIndex + 1).join("\n").replace(/^\n+/, ""),
		rawFrontmatter,
	};
}

export function renderFrontmatter(values: Record<string, string>, fieldOrder?: string[]): string {
	const orderedKeys = fieldOrder ?? Object.keys(values);
	const lines = orderedKeys
		.filter((key) => values[key] !== undefined)
		.map((key) => `${key}: ${renderFrontmatterValue(values[key]!)}`);
	return [FRONTMATTER_BOUNDARY, ...lines, FRONTMATTER_BOUNDARY].join("\n");
}

function renderFrontmatterValue(value: string): string {
	const normalized = value.replace(/\r?\n/g, " ").trim();
	return JSON.stringify(normalized);
}

function normalizeHeading(value: string): string {
	return value.trim().toLowerCase();
}

export function parseLearningSections(body: string): LearningSections {
	const sections: Record<string, string[]> = {};
	let current: keyof LearningSections | undefined;
	for (const line of body.split(/\r?\n/)) {
		const headingMatch = /^##\s+(.+)$/.exec(line.trim());
		if (headingMatch) {
			const heading = normalizeHeading(headingMatch[1] ?? "");
			current = undefined;
			if (heading === "why") current = "why";
			if (heading === "when to apply") current = "whenToApply";
			if (heading === "when not to apply") current = "whenNotToApply";
			if (heading === "details") current = "details";
			if (current) sections[current] = sections[current] ?? [];
			continue;
		}
		if (!current) continue;
		sections[current].push(line);
	}

	return {
		why: finalizeSection(sections.why),
		whenToApply: finalizeSection(sections.whenToApply),
		whenNotToApply: finalizeSection(sections.whenNotToApply),
		details: finalizeSection(sections.details),
	};
}

function finalizeSection(lines: string[] | undefined): string | undefined {
	if (!lines) return undefined;
	const text = lines.join("\n").trim();
	return text || undefined;
}

export function renderLearningBody(sections: LearningSections): string {
	const ordered: Array<[keyof LearningSections, string]> = [
		["why", SECTION_TITLES.why],
		["whenToApply", SECTION_TITLES.whenToApply],
		["whenNotToApply", SECTION_TITLES.whenNotToApply],
		["details", SECTION_TITLES.details],
	];
	const blocks: string[] = [];
	for (const [key, title] of ordered) {
		const value = sections[key]?.trim();
		if (!value) continue;
		blocks.push(`## ${title}\n\n${value}`);
	}
	return blocks.join("\n\n").trim();
}

export function ensureStructuredLearningBody(body: string, summary: string): string {
	const existing = parseLearningSections(body);
	const hasStructuredContent = Boolean(existing.why || existing.whenToApply || existing.whenNotToApply || existing.details);
	const normalized = {
		why: existing.why ?? `This learning matters because ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`,
		whenToApply: existing.whenToApply ?? "Apply this when the same pattern or decision point appears again.",
		whenNotToApply: existing.whenNotToApply,
		details: existing.details ?? (!hasStructuredContent ? (body.trim() || undefined) : undefined),
	};
	return renderLearningBody(normalized);
}

export function hasStructuredBody(body: string): boolean {
	const sections = parseLearningSections(body);
	return Boolean(sections.why && sections.whenToApply);
}
