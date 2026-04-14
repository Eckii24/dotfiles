import { dirname, resolve } from "node:path";
import type { MemorySnippet, SkippedSource, TaskClassification } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import { compactLines, extractBullets, firstParagraph, matchedKeywords, parseMarkdownSections, readOptionalText } from "./markdown.js";

export interface ReferenceManifestEntry {
	id: string;
	title: string;
	notePath: string;
	indexPath: string;
	status: "active" | "archived" | "superseded";
	tags: string[];
	summary?: string;
}

function metadataMap(lines: string[]): Map<string, string> {
	const metadata = new Map<string, string>();
	for (const rawLine of lines) {
		const match = /^-\s+\*\*(.+?)\*\*:\s*(.*)$/.exec(rawLine.trim());
		if (!match) continue;
		metadata.set(match[1].trim().toLowerCase(), (match[2] ?? "").trim());
	}
	return metadata;
}

function parseBlocks(raw: string): Array<{ heading: string; lines: string[] }> {
	const lines = raw.split(/\r?\n/);
	const blocks: Array<{ heading: string; lines: string[] }> = [];
	let current: { heading: string; lines: string[] } | undefined;
	for (const line of lines) {
		const headingMatch = /^##\s+(.+)$/.exec(line.trim());
		if (headingMatch) {
			if (current) blocks.push(current);
			current = { heading: (headingMatch[1] ?? "").trim(), lines: [] };
			continue;
		}
		if (current) current.lines.push(line);
	}
	if (current) blocks.push(current);
	return blocks;
}

export async function loadReferenceIndex(indexPath: string): Promise<ReferenceManifestEntry[]> {
	const raw = await readOptionalText(indexPath);
	if (!raw) return [];
	const entries: ReferenceManifestEntry[] = [];
	for (const block of parseBlocks(raw)) {
		const metadata = metadataMap(block.lines);
		const pathValue = metadata.get("path");
		if (!pathValue) continue;
		entries.push({
			id: block.heading,
			title: metadata.get("title") || block.heading,
			notePath: resolve(dirname(indexPath), pathValue),
			indexPath,
			status: ((metadata.get("status") as ReferenceManifestEntry["status"] | undefined) ?? "active"),
			tags: (metadata.get("tags") ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
			summary: metadata.get("summary") || undefined,
		});
	}
	return entries;
}

async function referenceEntryToSnippet(entry: ReferenceManifestEntry, promptKeywords: string[], classification: TaskClassification): Promise<MemorySnippet | undefined> {
	if (entry.status !== "active") return undefined;
	const raw = await readOptionalText(entry.notePath);
	if (!raw) return undefined;
	const sections = parseMarkdownSections(raw);
	const paragraph = firstParagraph(sections.get("__root__")) ?? entry.summary;
	const bullets = compactLines([
		...extractBullets(sections.get("key findings")),
		...extractBullets(sections.get("analysis")),
	], 4);
	const summaryLines = compactLines([
		paragraph ?? "",
		...bullets,
	], 4);
	const matchedTerms = matchedKeywords([entry.title, entry.tags.join(" "), entry.summary ?? "", summaryLines.join(" ")].join("\n"), promptKeywords);
	if (classification !== "reference-lookup" && matchedTerms.length === 0) return undefined;
	const summary = [
		...(entry.tags.length > 0 ? [`- tags: ${entry.tags.join(", ")}`] : []),
		...summaryLines.map((line) => `- ${line}`),
	].join("\n");
	const priorityBase = classification === "reference-lookup" ? 94 : classification === "repo-implementation" ? 72 : 58;
	return {
		kind: "reference-note",
		scope: "project",
		sourcePath: entry.notePath,
		exists: true,
		title: `Reference — ${entry.title}`,
		summary,
		estimatedTokens: estimateTokens(summary),
		priority: priorityBase + matchedTerms.length * 14,
		requiresValidation: true,
		validationReason: "Reference summaries support retrieval, but live workspace facts still need validation.",
		dedupeKey: normalizeForDedupe([entry.title, summary].join(" | ")),
		matchedTerms,
	};
}

export async function rankReferenceSnippets(options: {
	indexPath: string;
	promptKeywords: string[];
	classification: TaskClassification;
	skipped?: SkippedSource[];
}): Promise<MemorySnippet[]> {
	const entries = await loadReferenceIndex(options.indexPath);
	if (entries.length === 0) {
		options.skipped?.push({
			kind: "references-index",
			sourcePath: options.indexPath,
			reason: "Reference index not found or contains no active entries.",
		});
		return [];
	}
	const snippets: MemorySnippet[] = [];
	for (const entry of entries) {
		const snippet = await referenceEntryToSnippet(entry, options.promptKeywords, options.classification);
		if (snippet) snippets.push(snippet);
		else {
			options.skipped?.push({
				kind: "reference-note",
				sourcePath: entry.notePath,
				reason: entry.status !== "active" ? `Reference is ${entry.status}.` : "Reference did not match this task strongly enough.",
			});
		}
	}
	return snippets.sort((left, right) => right.priority - left.priority);
}
