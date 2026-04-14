import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArtifactKind, MemoryPaths, MemoryScope, MemorySnippet, SkippedSource, TaskClassification } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import { compactLines, matchedKeywords, parseMarkdownSections, readOptionalText } from "./markdown.js";

export const MAX_ACTIVE_LEARNING_RECORDS = 30;
const RECORD_PREFIX = "L-";
const PENDING_PREFIX = "P-";
export const STALE_LEARNING_DAYS = 90;

type LearningCategory =
	| "mistake-pattern"
	| "successful-tactic"
	| "user-preference"
	| "convention-discovery"
	| "tool-usage-pattern";

type LearningConfidence = "high" | "medium" | "low";

type LearningStoreTarget = "global" | "project";

export interface LearningRecord {
	id: string;
	title: string;
	category: LearningCategory;
	scopeLabel: string;
	scope: MemoryScope;
	source: string;
	created?: string;
	lastValidated?: string;
	occurrences: number;
	confidence: LearningConfidence;
	supersedes?: string;
	extends?: string;
	derivedFrom: string[];
	pattern?: string;
	recommendation?: string;
	evidence: string[];
	sourcePath: string;
	storeTarget: LearningStoreTarget;
	dedupeKey: string;
	matchedTerms?: string[];
	stale: boolean;
}

export interface LearningRecommendation {
	title: string;
	category: LearningCategory;
	scopeLabel: string;
	source: string;
	confidence: LearningConfidence;
	pattern?: string;
	recommendation?: string;
	evidence: string[];
	storeTarget: LearningStoreTarget;
	occurrenceDelta: number;
	whyPending?: string;
	supersedes?: string;
	extends?: string;
	derivedFrom?: string[];
	created?: string;
	lastValidated?: string;
}

export interface PendingLearningRecommendation extends LearningRecommendation {
	id: string;
	status: "pending";
	whyPending?: string;
	dedupeKey: string;
	sourcePath: string;
}

export interface LearningStore {
	target: LearningStoreTarget;
	sourcePath: string;
	records: LearningRecord[];
	archivedSectionContent?: string;
}

export interface PendingLearningsState {
	sourcePath: string;
	recommendations: PendingLearningRecommendation[];
}

export interface PendingLearningsSummary {
	sourcePath: string;
	total: number;
	manualCount: number;
	scheduledCount: number;
	highConfidenceCount: number;
}

export interface LearningAction extends LearningRecommendation {
	action: "approve" | "queue" | "reject";
	target?: LearningStoreTarget;
}

export interface AppliedLearningActionsResult {
	approvedGlobal: number;
	approvedProject: number;
	queued: number;
	rejected: number;
	blockedByCapacity: number;
	capacityTargets: LearningStoreTarget[];
	changedPaths: string[];
	pendingCount: number;
}

function todayStamp(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

function normalizeScope(scopeLabel: string | undefined): { scopeLabel: string; scope: MemoryScope } {
	const value = (scopeLabel ?? "project").trim();
	if (value === "global") return { scopeLabel: value, scope: "global" };
	if (value.startsWith("feature:")) return { scopeLabel: value, scope: "feature" };
	return { scopeLabel: value || "project", scope: "project" };
}

function confidenceRank(confidence: LearningConfidence): number {
	switch (confidence) {
		case "high":
			return 3;
		case "medium":
			return 2;
		default:
			return 1;
	}
}

function categoryFromValue(value: string | undefined): LearningCategory {
	const candidate = (value ?? "successful-tactic").trim() as LearningCategory;
	if (
		candidate === "mistake-pattern" ||
		candidate === "successful-tactic" ||
		candidate === "user-preference" ||
		candidate === "convention-discovery" ||
		candidate === "tool-usage-pattern"
	) {
		return candidate;
	}
	return "successful-tactic";
}

function confidenceFromValue(value: string | undefined): LearningConfidence {
	const candidate = (value ?? "medium").trim() as LearningConfidence;
	return candidate === "high" || candidate === "medium" || candidate === "low" ? candidate : "medium";
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

function normalizeEvidence(lines: string[]): string[] {
	return compactLines(
		lines
			.map((line) => line.replace(/^[-*]\s+/, "").trim())
			.filter(Boolean),
		8,
	);
}

function collectSectionBullets(lines: string[] | undefined): string[] {
	if (!lines) return [];
	return normalizeEvidence(lines);
}

function getSectionParagraph(lines: string[] | undefined): string | undefined {
	if (!lines || lines.length === 0) return undefined;
	const text = lines
		.map((line) => line.trim())
		.filter((line) => line && !/^[-*]\s+/.test(line))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return text || undefined;
}

function buildLearningDedupeKey(input: {
	title: string;
	scopeLabel: string;
	pattern?: string;
	recommendation?: string;
}): string {
	return normalizeForDedupe([input.title, input.scopeLabel, input.pattern ?? "", input.recommendation ?? ""].join(" | "));
}

function buildLearningRetrievalKey(input: { title: string; pattern?: string; recommendation?: string }): string {
	return normalizeForDedupe([input.title, input.pattern ?? "", input.recommendation ?? ""].join(" | "));
}

function parseRecordBlocks(raw: string, prefix: string): Array<{ heading: string; lines: string[] }> {
	const lines = raw.split(/\r?\n/);
	const blocks: Array<{ heading: string; lines: string[] }> = [];
	let current: { heading: string; lines: string[] } | undefined;

	for (const line of lines) {
		const headingMatch = /^##\s+(.+)$/.exec(line.trim());
		if (headingMatch) {
			if (current) blocks.push(current);
			const heading = (headingMatch[1] ?? "").trim();
			current = heading.startsWith(prefix) ? { heading, lines: [] } : undefined;
			continue;
		}
		if (current) current.lines.push(line);
	}
	if (current) blocks.push(current);
	return blocks;
}

function parseLearningRecord(block: { heading: string; lines: string[] }, sourcePath: string, storeTarget: LearningStoreTarget): LearningRecord {
	const headingMatch = /^(L-\d{8}-\d{3})\s+[—-]\s+(.+)$/.exec(block.heading.trim());
	const id = headingMatch?.[1] ?? block.heading.trim();
	const title = headingMatch?.[2]?.trim() ?? block.heading.trim();
	const metadata = metadataMap(block.lines);
	const scopeInfo = normalizeScope(metadata.get("scope"));
	const sectionText = [`## ${block.heading}`, ...block.lines].join("\n");
	const sections = parseMarkdownSections(sectionText);
	const patternLines = sections.get("pattern");
	const recommendationLines = sections.get("recommendation");
	const evidenceLines = sections.get("evidence");
	const pattern = getSectionParagraph(patternLines) ?? collectSectionBullets(patternLines).join(" ");
	const recommendation = getSectionParagraph(recommendationLines) ?? collectSectionBullets(recommendationLines).join(" ");
	const evidence = collectSectionBullets(evidenceLines);
	const dedupeKey = buildLearningDedupeKey({ title, scopeLabel: scopeInfo.scopeLabel, pattern, recommendation });
	const lastValidated = metadata.get("last validated") || metadata.get("last validated ");

	return {
		id,
		title,
		category: categoryFromValue(metadata.get("category")),
		scopeLabel: scopeInfo.scopeLabel,
		scope: scopeInfo.scope,
		source: metadata.get("source") ?? "manual",
		created: metadata.get("created"),
		lastValidated,
		occurrences: Math.max(0, Number.parseInt(metadata.get("occurrences") ?? "0", 10) || 0),
		confidence: confidenceFromValue(metadata.get("confidence")),
		supersedes: metadata.get("supersedes") || undefined,
		extends: metadata.get("extends") || undefined,
		derivedFrom: (metadata.get("derived-from") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
		pattern: pattern || undefined,
		recommendation: recommendation || undefined,
		evidence,
		sourcePath,
		storeTarget,
		dedupeKey,
		stale: isLearningStale({ lastValidated }),
	};
}

function parsePendingRecommendation(block: { heading: string; lines: string[] }, sourcePath: string): PendingLearningRecommendation {
	const headingMatch = /^(P-\d{8}-\d{3})\s+[—-]\s+(.+)$/.exec(block.heading.trim());
	const id = headingMatch?.[1] ?? block.heading.trim();
	const title = headingMatch?.[2]?.trim() ?? block.heading.trim();
	const metadata = metadataMap(block.lines);
	const scopeInfo = normalizeScope(metadata.get("scope"));
	const sectionText = [`## ${block.heading}`, ...block.lines].join("\n");
	const sections = parseMarkdownSections(sectionText);
	const patternLines = sections.get("pattern");
	const recommendationLines = sections.get("recommendation");
	const evidenceLines = sections.get("evidence");
	const pattern = getSectionParagraph(patternLines) ?? collectSectionBullets(patternLines).join(" ");
	const recommendation = getSectionParagraph(recommendationLines) ?? collectSectionBullets(recommendationLines).join(" ");
	const evidence = collectSectionBullets(evidenceLines);
	const storeTarget = metadata.get("target") === "global" ? "global" : "project";
	const occurrenceDelta = Math.max(0, Number.parseInt(metadata.get("occurrence delta") ?? "0", 10) || 0);
	const normalizedDelta = (metadata.get("source") ?? "").startsWith("scheduled-analysis:") ? 0 : occurrenceDelta;
	const dedupeKey = buildLearningDedupeKey({ title, scopeLabel: scopeInfo.scopeLabel, pattern, recommendation });

	return {
		id,
		title,
		category: categoryFromValue(metadata.get("category")),
		scopeLabel: scopeInfo.scopeLabel,
		source: metadata.get("source") ?? "manual",
		confidence: confidenceFromValue(metadata.get("confidence")),
		pattern: pattern || undefined,
		recommendation: recommendation || undefined,
		evidence,
		storeTarget,
		occurrenceDelta: normalizedDelta,
		supersedes: metadata.get("supersedes") || undefined,
		extends: metadata.get("extends") || undefined,
		derivedFrom: (metadata.get("derived-from") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
		created: metadata.get("created"),
		lastValidated: metadata.get("last validated") || undefined,
		status: "pending",
		whyPending: metadata.get("why pending") || undefined,
		dedupeKey,
		sourcePath,
	};
}

function renderLearningRecord(record: LearningRecord): string {
	const lines: string[] = [];
	lines.push(`## ${record.id} — ${record.title}`);
	lines.push("");
	lines.push(`- **Category**: ${record.category}`);
	lines.push(`- **Scope**: ${record.scopeLabel}`);
	lines.push(`- **Source**: ${record.source}`);
	lines.push(`- **Created**: ${record.created ?? todayStamp()}`);
	lines.push(`- **Last validated**: ${record.lastValidated ?? todayStamp()}`);
	lines.push(`- **Occurrences**: ${record.occurrences}`);
	lines.push(`- **Confidence**: ${record.confidence}`);
	if (record.supersedes) lines.push(`- **Supersedes**: ${record.supersedes}`);
	if (record.extends) lines.push(`- **Extends**: ${record.extends}`);
	if (record.derivedFrom.length > 0) lines.push(`- **Derived-from**: ${record.derivedFrom.join(", ")}`);
	lines.push("");
	lines.push("### Pattern");
	lines.push(record.pattern ?? "No pattern summary recorded.");
	lines.push("");
	lines.push("### Recommendation");
	lines.push(record.recommendation ?? "No recommendation summary recorded.");
	lines.push("");
	lines.push("### Evidence");
	if (record.evidence.length === 0) lines.push("- No explicit evidence paths recorded.");
	for (const evidence of record.evidence) lines.push(`- ${evidence}`);
	lines.push("");
	return lines.join("\n");
}

function renderPendingRecommendation(record: PendingLearningRecommendation): string {
	const lines: string[] = [];
	lines.push(`## ${record.id} — ${record.title}`);
	lines.push("");
	lines.push(`- **Target**: ${record.storeTarget}`);
	lines.push(`- **Category**: ${record.category}`);
	lines.push(`- **Scope**: ${record.scopeLabel}`);
	lines.push(`- **Source**: ${record.source}`);
	lines.push(`- **Status**: ${record.status}`);
	lines.push(`- **Occurrence delta**: ${record.source.startsWith("scheduled-analysis:") ? 0 : record.occurrenceDelta}`);
	lines.push(`- **Confidence**: ${record.confidence}`);
	lines.push(`- **Created**: ${record.created ?? todayStamp()}`);
	if (record.lastValidated) lines.push(`- **Last validated**: ${record.lastValidated}`);
	if (record.supersedes) lines.push(`- **Supersedes**: ${record.supersedes}`);
	if (record.extends) lines.push(`- **Extends**: ${record.extends}`);
	if (record.derivedFrom.length > 0) lines.push(`- **Derived-from**: ${record.derivedFrom.join(", ")}`);
	if (record.whyPending) lines.push(`- **Why pending**: ${record.whyPending}`);
	lines.push("");
	lines.push("### Pattern");
	lines.push(record.pattern ?? "No pattern summary recorded.");
	lines.push("");
	lines.push("### Recommendation");
	lines.push(record.recommendation ?? "No recommendation summary recorded.");
	lines.push("");
	lines.push("### Evidence");
	if (record.evidence.length === 0) lines.push("- No explicit evidence paths recorded.");
	for (const evidence of record.evidence) lines.push(`- ${evidence}`);
	lines.push("");
	return lines.join("\n");
}

function renderLearningStore(store: LearningStore): string {
	const title = store.target === "global" ? "Global Learning Store" : "Project Learning Store";
	const scope = store.target === "global" ? "global" : "project";
	const lines: string[] = [];
	lines.push(`# ${title}`);
	lines.push("");
	lines.push(`- **Scope**: ${scope}`);
	lines.push(`- **Updated**: ${todayStamp()}`);
	lines.push(`- **Active record cap**: ${MAX_ACTIVE_LEARNING_RECORDS}`);
	lines.push("- **Promotion threshold**: 2 confirmed inline/manual occurrences");
	lines.push("");
	if (store.records.length === 0) {
		lines.push("<!-- Add approved learning records below using `## L-YYYYMMDD-NNN — Title`. -->");
		lines.push("");
	} else {
		for (const record of [...store.records].sort((left, right) => left.id.localeCompare(right.id))) {
			lines.push(renderLearningRecord(record).trimEnd());
		}
	}
	lines.push("## Archived Records");
	lines.push("");
	if (store.archivedSectionContent?.trim()) {
		lines.push(store.archivedSectionContent.trimEnd());
		lines.push("");
	} else {
		lines.push("<!-- Move promoted, stale, or superseded records here as `### L-...` blocks or separate notes. -->");
		lines.push("");
	}
	return lines.join("\n");
}

function renderPendingState(state: PendingLearningsState): string {
	const lines: string[] = [];
	lines.push("# Pending Learnings");
	lines.push("");
	lines.push("- **Updated**: " + todayStamp());
	lines.push("- **Policy**: Scheduled/headless discoveries stay pending until explicit approval.");
	lines.push("- **Manual occurrence rule**: Only inline/manual analysis may increment occurrences.");
	lines.push("");
	if (state.recommendations.length === 0) {
		lines.push("<!-- Pending learning recommendations appear below as `## P-YYYYMMDD-NNN — Title`. -->");
		lines.push("");
	} else {
		for (const recommendation of [...state.recommendations].sort((left, right) => left.id.localeCompare(right.id))) {
			lines.push(renderPendingRecommendation(recommendation).trimEnd());
		}
	}
	lines.push("## Archived Recommendations");
	lines.push("");
	lines.push("<!-- Move reviewed or rejected items here as `### P-...` blocks if history is useful. -->");
	lines.push("");
	return lines.join("\n");
}

function nextRecordId(existingIds: string[], prefix: string, date = new Date()): string {
	const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
	const todays = existingIds
		.map((id) => new RegExp(`^${prefix}${stamp}-(\\d{3})$`).exec(id)?.[1])
		.filter((value): value is string => Boolean(value))
		.map((value) => Number.parseInt(value, 10))
		.filter((value) => Number.isFinite(value));
	const next = (todays.length === 0 ? 0 : Math.max(...todays)) + 1;
	return `${prefix}${stamp}-${String(next).padStart(3, "0")}`;
}

function mergeEvidence(left: string[], right: string[]): string[] {
	return compactLines([...left, ...right], 12);
}

function mergeDerivedFrom(left: string[], right: string[]): string[] {
	return compactLines([...left, ...right], 8);
}

function recommendationToRecord(recommendation: LearningRecommendation, sourcePath: string, existing?: LearningRecord): LearningRecord {
	const scopeInfo = normalizeScope(recommendation.scopeLabel);
	const occurrenceDelta = recommendation.source.startsWith("scheduled-analysis:") ? 0 : Math.max(0, recommendation.occurrenceDelta);
	const created = existing?.created ?? recommendation.created ?? todayStamp();
	const lastValidated = occurrenceDelta > 0 ? recommendation.lastValidated ?? todayStamp() : existing?.lastValidated ?? recommendation.lastValidated;
	return {
		id: existing?.id ?? "",
		title: recommendation.title,
		category: recommendation.category,
		scopeLabel: scopeInfo.scopeLabel,
		scope: scopeInfo.scope,
		source: existing?.source ?? recommendation.source,
		created,
		lastValidated,
		occurrences: (existing?.occurrences ?? 0) + occurrenceDelta,
		confidence:
			confidenceRank(existing?.confidence ?? "low") >= confidenceRank(recommendation.confidence)
				? existing?.confidence ?? recommendation.confidence
				: recommendation.confidence,
		supersedes: recommendation.supersedes ?? existing?.supersedes,
		extends: recommendation.extends ?? existing?.extends,
		derivedFrom: mergeDerivedFrom(existing?.derivedFrom ?? [], recommendation.derivedFrom ?? []),
		pattern: recommendation.pattern ?? existing?.pattern,
		recommendation: recommendation.recommendation ?? existing?.recommendation,
		evidence: mergeEvidence(existing?.evidence ?? [], recommendation.evidence),
		sourcePath,
		storeTarget: recommendation.storeTarget,
		dedupeKey: buildLearningDedupeKey({
			title: recommendation.title,
			scopeLabel: scopeInfo.scopeLabel,
			pattern: recommendation.pattern ?? existing?.pattern,
			recommendation: recommendation.recommendation ?? existing?.recommendation,
		}),
		stale: isLearningStale({ lastValidated }),
	};
}

function recommendationToPendingRecord(recommendation: LearningRecommendation, sourcePath: string, existing?: PendingLearningRecommendation): PendingLearningRecommendation {
	const scopeInfo = normalizeScope(recommendation.scopeLabel);
	const incomingScheduled = recommendation.source.startsWith("scheduled-analysis:");
	const existingScheduled = existing?.source.startsWith("scheduled-analysis:") ?? false;
	const occurrenceDelta = incomingScheduled ? 0 : Math.max(0, recommendation.occurrenceDelta);
	const pattern = recommendation.pattern ?? existing?.pattern;
	const recText = recommendation.recommendation ?? existing?.recommendation;
	const dedupeKey = buildLearningDedupeKey({
		title: recommendation.title,
		scopeLabel: scopeInfo.scopeLabel,
		pattern,
		recommendation: recText,
	});
	const strongestSource = !existing
		? recommendation.source
		: !incomingScheduled && existingScheduled
			? recommendation.source
			: incomingScheduled && !existingScheduled
				? existing.source
				: recommendation.source;
	const strongestOccurrenceDelta = !existing
		? occurrenceDelta
		: incomingScheduled && !existingScheduled
			? existing.occurrenceDelta
			: Math.max(existing.occurrenceDelta, occurrenceDelta);
	const whyPending =
		recommendation.whyPending ??
		(incomingScheduled && !existing ? "Scheduled/headless discoveries require later interactive approval." : existing?.whyPending);
	return {
		id: existing?.id ?? "",
		title: recommendation.title,
		category: recommendation.category,
		scopeLabel: scopeInfo.scopeLabel,
		source: strongestSource,
		confidence:
			confidenceRank(existing?.confidence ?? "low") >= confidenceRank(recommendation.confidence)
				? existing?.confidence ?? recommendation.confidence
				: recommendation.confidence,
		pattern,
		recommendation: recText,
		evidence: mergeEvidence(existing?.evidence ?? [], recommendation.evidence),
		storeTarget: recommendation.storeTarget,
		occurrenceDelta: strongestOccurrenceDelta,
		supersedes: recommendation.supersedes ?? existing?.supersedes,
		extends: recommendation.extends ?? existing?.extends,
		derivedFrom: mergeDerivedFrom(existing?.derivedFrom ?? [], recommendation.derivedFrom ?? []),
		created: existing?.created ?? recommendation.created ?? todayStamp(),
		lastValidated: recommendation.lastValidated ?? existing?.lastValidated,
		status: "pending",
		whyPending,
		dedupeKey,
		sourcePath,
	};
}

export function isLearningStale(record: { lastValidated?: string }, now = new Date()): boolean {
	if (!record.lastValidated) return false;
	const parsed = new Date(record.lastValidated);
	if (Number.isNaN(parsed.getTime())) return false;
	const ageMs = now.getTime() - parsed.getTime();
	return ageMs > STALE_LEARNING_DAYS * 24 * 60 * 60 * 1000;
}

function extractArchivedSectionContent(raw: string): string | undefined {
	const lines = raw.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => line.trim() === "## Archived Records");
	if (headingIndex === -1) return undefined;
	const content = lines.slice(headingIndex + 1).join("\n").trim();
	return content || undefined;
}

export async function loadLearningStore(path: string, target: LearningStoreTarget): Promise<LearningStore | undefined> {
	const raw = await readOptionalText(path);
	if (!raw) return undefined;
	const records = parseRecordBlocks(raw, RECORD_PREFIX).map((block) => parseLearningRecord(block, path, target));
	return { target, sourcePath: path, records, archivedSectionContent: extractArchivedSectionContent(raw) };
}

export async function loadPendingLearnings(path: string): Promise<PendingLearningsState | undefined> {
	const raw = await readOptionalText(path);
	if (!raw) return undefined;
	const recommendations = parseRecordBlocks(raw, PENDING_PREFIX).map((block) => parsePendingRecommendation(block, path));
	return { sourcePath: path, recommendations };
}

export function summarizePendingLearnings(state: PendingLearningsState): PendingLearningsSummary {
	return {
		sourcePath: state.sourcePath,
		total: state.recommendations.length,
		manualCount: state.recommendations.filter((recommendation) => !recommendation.source.startsWith("scheduled-analysis:")).length,
		scheduledCount: state.recommendations.filter((recommendation) => recommendation.source.startsWith("scheduled-analysis:")).length,
		highConfidenceCount: state.recommendations.filter((recommendation) => recommendation.confidence === "high").length,
	};
}

export function pendingLearningsToSnippet(summary: PendingLearningsSummary): MemorySnippet {
	const lines = [
		`- pending-count: ${summary.total}`,
		`- scheduled: ${summary.scheduledCount}`,
		`- manual: ${summary.manualCount}`,
		`- high-confidence: ${summary.highConfidenceCount}`,
		"- action: review queued learnings with /learn, approve via questionnaire, then persist with memory_apply_learning_actions.",
	].join("\n");
	return {
		kind: "pending-learnings",
		scope: "project",
		sourcePath: summary.sourcePath,
		exists: true,
		title: "Pending Learnings Queue",
		summary: lines,
		estimatedTokens: estimateTokens(lines),
		priority: 72 + Math.min(summary.total, 6) * 2,
		requiresValidation: false,
		dedupeKey: normalizeForDedupe(`pending:${summary.sourcePath}:${summary.total}`),
	};
}

export function isPromotionEligibleLearning(record: LearningRecord): boolean {
	return !record.stale && record.occurrences >= 2 && !record.source.startsWith("scheduled-analysis:");
}

export function listPromotionEligibleLearnings(records: LearningRecord[]): LearningRecord[] {
	return records.filter((record) => isPromotionEligibleLearning(record));
}

export function listStaleLearningRecords(records: LearningRecord[]): LearningRecord[] {
	return records.filter((record) => record.stale);
}

function renderArchivedLearningRecord(options: {
	record: LearningRecord;
	reason: string;
	archivedAt: string;
	durableTarget?: string;
	supersededBy?: string;
}): string {
	const lines: string[] = [];
	lines.push(`### ${options.record.id} — ${options.record.title}`);
	lines.push("");
	lines.push(`- **Archived**: ${options.archivedAt}`);
	lines.push(`- **Reason**: ${options.reason}`);
	if (options.durableTarget) lines.push(`- **Durable target**: ${options.durableTarget}`);
	if (options.supersededBy) lines.push(`- **Superseded by**: ${options.supersededBy}`);
	lines.push(`- **Category**: ${options.record.category}`);
	lines.push(`- **Scope**: ${options.record.scopeLabel}`);
	lines.push(`- **Source**: ${options.record.source}`);
	lines.push(`- **Last validated**: ${options.record.lastValidated ?? "unknown"}`);
	lines.push(`- **Occurrences**: ${options.record.occurrences}`);
	if (options.record.supersedes) lines.push(`- **Supersedes**: ${options.record.supersedes}`);
	if (options.record.extends) lines.push(`- **Extends**: ${options.record.extends}`);
	if (options.record.derivedFrom.length > 0) lines.push(`- **Derived-from**: ${options.record.derivedFrom.join(", ")}`);
	lines.push("");
	lines.push("#### Pattern");
	lines.push(options.record.pattern ?? "No pattern summary recorded.");
	lines.push("");
	lines.push("#### Recommendation");
	lines.push(options.record.recommendation ?? "No recommendation summary recorded.");
	lines.push("");
	lines.push("#### Evidence");
	if (options.record.evidence.length === 0) lines.push("- No explicit evidence paths recorded.");
	for (const evidence of options.record.evidence) lines.push(`- ${evidence}`);
	lines.push("");
	return lines.join("\n");
}

export async function validateLearningRecords(options: {
	path: string;
	target: LearningStoreTarget;
	recordIds: string[];
	validatedAt?: string;
}): Promise<LearningStore> {
	const store = (await loadLearningStore(options.path, options.target)) ?? {
		target: options.target,
		sourcePath: options.path,
		records: [],
	};
	const stamp = options.validatedAt ?? todayStamp();
	const records = store.records.map((record) =>
		options.recordIds.includes(record.id)
			? {
				...record,
				lastValidated: stamp,
				stale: false,
			}
			: record,
	);
	const nextStore: LearningStore = { ...store, records };
	await mkdir(dirname(options.path), { recursive: true });
	await writeFile(options.path, renderLearningStore(nextStore), "utf8");
	return nextStore;
}

export async function archiveLearningRecords(options: {
	path: string;
	target: LearningStoreTarget;
	recordIds: string[];
	reason: string;
	archivedAt?: string;
	durableTarget?: string;
	supersededBy?: string;
}): Promise<LearningStore> {
	const store = (await loadLearningStore(options.path, options.target)) ?? {
		target: options.target,
		sourcePath: options.path,
		records: [],
	};
	const selected = store.records.filter((record) => options.recordIds.includes(record.id));
	const records = store.records.filter((record) => !options.recordIds.includes(record.id));
	const archiveParts = [
		store.archivedSectionContent?.trim() ?? "",
		...selected.map((record) =>
			renderArchivedLearningRecord({
				record,
				reason: options.reason,
				archivedAt: options.archivedAt ?? todayStamp(),
				durableTarget: options.durableTarget,
				supersededBy: options.supersededBy,
			}),
		),
	].filter((part) => part.trim().length > 0);
	const archivedBlocks = archiveParts.join("\n\n");
	const nextStore: LearningStore = {
		...store,
		records,
		archivedSectionContent: archivedBlocks || store.archivedSectionContent,
	};
	await mkdir(dirname(options.path), { recursive: true });
	await writeFile(options.path, renderLearningStore(nextStore), "utf8");
	return nextStore;
}

function buildLearningSummary(record: LearningRecord): string {
	const lines: string[] = [];
	lines.push(`- category: ${record.category}`);
	lines.push(`- scope: ${record.scopeLabel}`);
	lines.push(`- occurrences: ${record.occurrences}`);
	lines.push(`- confidence: ${record.confidence}`);
	if (record.stale) lines.push("- stale: review before treating as active guidance");
	if (record.pattern) lines.push(`- pattern: ${record.pattern}`);
	if (record.recommendation) lines.push(`- recommendation: ${record.recommendation}`);
	if (record.evidence.length > 0) lines.push(`- evidence: ${record.evidence.slice(0, 2).join(" | ")}`);
	return lines.join("\n");
}

function learningPriorityBase(target: LearningStoreTarget, classification: TaskClassification): number {
	if (target === "project") {
		return classification === "feature-continuation" || classification === "repo-implementation" ? 96 : 84;
	}
	return classification === "general-global" ? 82 : 74;
}

function learningKind(target: LearningStoreTarget): ArtifactKind {
	return target === "project" ? "learning-project" : "learning-global";
}

export function rankLearningSnippets(options: {
	records: LearningRecord[];
	target: LearningStoreTarget;
	promptKeywords: string[];
	classification: TaskClassification;
	skipped?: SkippedSource[];
}): MemorySnippet[] {
	const snippets: MemorySnippet[] = [];
	for (const record of options.records) {
		const haystack = [record.title, record.pattern ?? "", record.recommendation ?? "", record.evidence.join(" ")].join("\n");
		const matchedTerms = matchedKeywords(haystack, options.promptKeywords);
		if (matchedTerms.length === 0 && options.classification !== "feature-continuation") {
			options.skipped?.push({
				kind: learningKind(options.target),
				sourcePath: record.sourcePath,
				reason: `Learning ${record.id} did not match this task strongly enough.`,
			});
			continue;
		}
		const summary = buildLearningSummary(record);
		const priority =
			learningPriorityBase(options.target, options.classification) +
			matchedTerms.length * 18 +
			record.occurrences * 3 +
			confidenceRank(record.confidence) * 4 -
			(record.stale ? 10 : 0);
		snippets.push({
			kind: learningKind(options.target),
			scope: record.scope,
			sourcePath: record.sourcePath,
			exists: true,
			title: `Learning — ${record.title}`,
			summary,
			estimatedTokens: estimateTokens(summary),
			priority,
			requiresValidation: true,
			validationReason: "Learning records are reusable hints, not canonical truth; validate workspace facts before relying on them.",
			dedupeKey: buildLearningRetrievalKey({
				title: record.title,
				pattern: record.pattern,
				recommendation: record.recommendation,
			}),
			matchedTerms,
		});
	}
	return snippets.sort((left, right) => right.priority - left.priority);
}

export async function persistApprovedLearnings(options: {
	path: string;
	target: LearningStoreTarget;
	recommendations: LearningRecommendation[];
}): Promise<LearningStore> {
	const store = (await loadLearningStore(options.path, options.target)) ?? {
		target: options.target,
		sourcePath: options.path,
		records: [],
	};
	const byDedupe = new Map(store.records.map((record) => [record.dedupeKey, record]));
	const records = [...store.records];

	for (const recommendation of options.recommendations) {
		const key = buildLearningDedupeKey({
			title: recommendation.title,
			scopeLabel: recommendation.scopeLabel,
			pattern: recommendation.pattern,
			recommendation: recommendation.recommendation,
		});
		const existing = byDedupe.get(key);
		const merged = recommendationToRecord(recommendation, options.path, existing);
		if (existing) {
			merged.id = existing.id;
			const index = records.findIndex((record) => record.id === existing.id);
			records[index] = merged;
			byDedupe.set(key, merged);
			continue;
		}
		if (records.length >= MAX_ACTIVE_LEARNING_RECORDS) {
			throw new Error(`Learning store cap reached at ${options.path}; archive, promote, or delete a record before adding more.`);
		}
		merged.id = nextRecordId(records.map((record) => record.id), RECORD_PREFIX);
		records.push(merged);
		byDedupe.set(key, merged);
	}

	const nextStore: LearningStore = { ...store, records };
	await mkdir(dirname(options.path), { recursive: true });
	await writeFile(options.path, renderLearningStore(nextStore), "utf8");
	return nextStore;
}

export function mergePendingRecommendations(
	existing: PendingLearningRecommendation[],
	incoming: LearningRecommendation[],
	sourcePath: string,
): PendingLearningRecommendation[] {
	const byDedupe = new Map(existing.map((recommendation) => [recommendation.dedupeKey, recommendation]));
	const merged = [...existing];
	for (const candidate of incoming) {
		const key = buildLearningDedupeKey({
			title: candidate.title,
			scopeLabel: candidate.scopeLabel,
			pattern: candidate.pattern,
			recommendation: candidate.recommendation,
		});
		const prior = byDedupe.get(key);
		const pending = recommendationToPendingRecord(candidate, sourcePath, prior);
		if (prior) {
			pending.id = prior.id;
			const index = merged.findIndex((recommendation) => recommendation.id === prior.id);
			merged[index] = pending;
			byDedupe.set(key, pending);
			continue;
		}
		pending.id = nextRecordId(merged.map((recommendation) => recommendation.id), PENDING_PREFIX);
		merged.push(pending);
		byDedupe.set(key, pending);
	}
	return merged.sort((left, right) => left.id.localeCompare(right.id));
}

export async function writePendingLearnings(path: string, recommendations: PendingLearningRecommendation[]): Promise<PendingLearningsState> {
	const state: PendingLearningsState = { sourcePath: path, recommendations };
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, renderPendingState(state), "utf8");
	return state;
}

export async function upsertPendingLearnings(path: string, recommendations: LearningRecommendation[]): Promise<PendingLearningsState> {
	const existing = (await loadPendingLearnings(path)) ?? { sourcePath: path, recommendations: [] };
	const merged = mergePendingRecommendations(existing.recommendations, recommendations, path);
	return writePendingLearnings(path, merged);
}

export async function applyLearningActions(paths: MemoryPaths, actions: LearningAction[]): Promise<AppliedLearningActionsResult> {
	const requestedApprovedGlobal = actions.filter((action) => action.action === "approve" && (action.target ?? action.storeTarget) === "global");
	const requestedApprovedProject = actions.filter((action) => action.action === "approve" && (action.target ?? action.storeTarget) === "project");
	const queued = actions.filter((action) => action.action === "queue");
	const rejected = actions.filter((action) => action.action === "reject");
	const touchedKeys = new Set(
		actions.map((action) =>
			buildLearningDedupeKey({
				title: action.title,
				scopeLabel: action.scopeLabel,
				pattern: action.pattern,
				recommendation: action.recommendation,
			}),
		),
	);
	const changedPaths = new Set<string>();
	const blockedByCapacity: LearningAction[] = [];

	async function splitByCapacity(target: LearningStoreTarget, path: string, approvals: LearningAction[]) {
		const store = (await loadLearningStore(path, target)) ?? { target, sourcePath: path, records: [] };
		const accepted: LearningAction[] = [];
		let activeCount = store.records.length;
		const seenNew = new Set(store.records.map((record) => record.dedupeKey));
		for (const approval of approvals) {
			const persistenceKey = buildLearningDedupeKey({
				title: approval.title,
				scopeLabel: approval.scopeLabel,
				pattern: approval.pattern,
				recommendation: approval.recommendation,
			});
			if (seenNew.has(persistenceKey)) {
				accepted.push(approval);
				continue;
			}
			if (activeCount >= MAX_ACTIVE_LEARNING_RECORDS) {
				blockedByCapacity.push({
					...approval,
					action: "queue",
					whyPending: `The ${target} learning store is full (${MAX_ACTIVE_LEARNING_RECORDS} active records). Ask the user via questionnaire whether to archive, promote, or delete lower-value records before re-approving this learning.`,
				});
				continue;
			}
			accepted.push(approval);
			seenNew.add(persistenceKey);
			activeCount += 1;
		}
		return accepted;
	}

	const approvedGlobal = await splitByCapacity("global", paths.learnings.globalPath, requestedApprovedGlobal);
	const approvedProject = await splitByCapacity("project", paths.learnings.projectPath, requestedApprovedProject);

	if (approvedGlobal.length > 0) {
		await persistApprovedLearnings({ path: paths.learnings.globalPath, target: "global", recommendations: approvedGlobal });
		changedPaths.add(paths.learnings.globalPath);
	}
	if (approvedProject.length > 0) {
		await persistApprovedLearnings({ path: paths.learnings.projectPath, target: "project", recommendations: approvedProject });
		changedPaths.add(paths.learnings.projectPath);
	}

	const existingPending = (await loadPendingLearnings(paths.pendingLearningsPath)) ?? { sourcePath: paths.pendingLearningsPath, recommendations: [] };
	const filteredPending = existingPending.recommendations.filter((recommendation) => !touchedKeys.has(recommendation.dedupeKey));
	const queueInputs = [...queued, ...blockedByCapacity];
	const nextPending = queueInputs.length > 0 ? mergePendingRecommendations(filteredPending, queueInputs, paths.pendingLearningsPath) : filteredPending;
	if (
		existingPending.recommendations.length > 0 ||
		queueInputs.length > 0 ||
		rejected.length > 0 ||
		approvedGlobal.length > 0 ||
		approvedProject.length > 0
	) {
		await writePendingLearnings(paths.pendingLearningsPath, nextPending);
		changedPaths.add(paths.pendingLearningsPath);
	}

	return {
		approvedGlobal: approvedGlobal.length,
		approvedProject: approvedProject.length,
		queued: queued.length + blockedByCapacity.length,
		rejected: rejected.length,
		blockedByCapacity: blockedByCapacity.length,
		capacityTargets: Array.from(new Set(blockedByCapacity.map((action) => action.target ?? action.storeTarget))),
		changedPaths: Array.from(changedPaths),
		pendingCount: nextPending.length,
	};
}
