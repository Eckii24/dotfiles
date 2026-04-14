import { readFile } from "node:fs/promises";

const FRONTMATTER_BOUNDARY = "---";
const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"how",
	"if",
	"in",
	"into",
	"is",
	"it",
	"of",
	"on",
	"or",
	"out",
	"that",
	"the",
	"their",
	"this",
	"to",
	"use",
	"with",
]);

export async function readOptionalText(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		const candidate = error as NodeJS.ErrnoException;
		if (candidate.code === "ENOENT") return undefined;
		throw error;
	}
}

export function stripFrontMatter(text: string): string {
	if (!text.startsWith(`${FRONTMATTER_BOUNDARY}\n`) && text !== FRONTMATTER_BOUNDARY) {
		return text;
	}

	const lines = text.split(/\r?\n/);
	if (lines[0] !== FRONTMATTER_BOUNDARY) return text;
	const closingIndex = lines.findIndex((line, index) => index > 0 && line === FRONTMATTER_BOUNDARY);
	if (closingIndex === -1) return text;
	return lines.slice(closingIndex + 1).join("\n").trimStart();
}

export function getMarkdownTitle(text: string, fallback: string): string {
	const lines = stripFrontMatter(text).split(/\r?\n/);
	const heading = lines.find((line) => /^#\s+/.test(line.trim()));
	return heading ? heading.replace(/^#\s+/, "").trim() : fallback;
}

export function parseMarkdownSections(text: string): Map<string, string[]> {
	const body = stripFrontMatter(text);
	const lines = body.split(/\r?\n/);
	const sections = new Map<string, string[]>();
	let current = "__root__";
	sections.set(current, []);

	for (const rawLine of lines) {
		const line = rawLine.replace(/\t/g, "    ");
		const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
		if (headingMatch) {
			current = normalizeHeading(headingMatch[2] ?? "");
			if (!sections.has(current)) sections.set(current, []);
			continue;
		}
		sections.get(current)?.push(line);
	}

	return sections;
}

export function normalizeHeading(value: string): string {
	return value.trim().toLowerCase();
}

export function extractBullets(lines: string[] | undefined): string[] {
	if (!lines || lines.length === 0) return [];
	const bullets: string[] = [];
	let current: string | undefined;

	for (const rawLine of lines) {
		const line = rawLine.trimEnd();
		if (!line.trim()) {
			if (current) {
				bullets.push(current.trim());
				current = undefined;
			}
			continue;
		}

		const bulletMatch = /^[-*]\s+(.*)$/.exec(line.trim()) ?? /^\d+\.\s+(.*)$/.exec(line.trim());
		if (bulletMatch) {
			if (current) bullets.push(current.trim());
			current = (bulletMatch[1] ?? "").trim();
			continue;
		}

		if (current && /^\s{2,}\S+/.test(line)) {
			current = `${current} ${line.trim()}`;
		}
	}

	if (current) bullets.push(current.trim());
	return bullets.filter(Boolean);
}

export function firstParagraph(lines: string[] | undefined): string | undefined {
	if (!lines || lines.length === 0) return undefined;
	const collected: string[] = [];
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			if (collected.length > 0) break;
			continue;
		}
		if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || /^\|/.test(line)) {
			if (collected.length === 0) continue;
			break;
		}
		collected.push(line);
	}
	if (collected.length === 0) return undefined;
	return collected.join(" ").replace(/\s+/g, " ").trim();
}

export function collectKeyLines(text: string, maxItems = 6): string[] {
	const sections = parseMarkdownSections(text);
	const items: string[] = [];

	for (const [heading, lines] of sections.entries()) {
		if (heading === "__root__") continue;
		const bullets = extractBullets(lines);
		for (const bullet of bullets) {
			items.push(`${heading}: ${bullet}`);
			if (items.length >= maxItems) return items;
		}

		const paragraph = firstParagraph(lines);
		if (paragraph) {
			items.push(`${heading}: ${paragraph}`);
			if (items.length >= maxItems) return items;
		}
	}

	return items;
}

export function keywordsFromText(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
	const deduped = new Set<string>();
	for (const match of matches) {
		if (STOP_WORDS.has(match)) continue;
		deduped.add(match);
	}
	return Array.from(deduped);
}

export function matchedKeywords(text: string, keywords: string[]): string[] {
	const lowered = text.toLowerCase();
	return keywords.filter((keyword) => lowered.includes(keyword));
}

export function compactLines(lines: string[], maxItems: number): string[] {
	const unique = new Set<string>();
	const compacted: string[] = [];
	for (const line of lines) {
		const normalized = line.replace(/\s+/g, " ").trim();
		if (!normalized || unique.has(normalized)) continue;
		unique.add(normalized);
		compacted.push(normalized);
		if (compacted.length >= maxItems) break;
	}
	return compacted;
}
