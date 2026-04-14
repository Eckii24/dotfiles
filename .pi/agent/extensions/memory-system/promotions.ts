import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { MemoryPaths, MemorySnippet } from "./contracts.js";
import { estimateTokens, normalizeForDedupe } from "./contracts.js";
import type { LearningRecord } from "./learnings.js";
import { compactLines, parseMarkdownSections, readOptionalText } from "./markdown.js";

const PROPOSAL_PREFIX = "M-";

export type MemoryProposalTarget = "conventions" | "pitfalls" | "decision" | "user-profile" | "project-profile";
export type ProfileProposalSection = "Stable Preferences" | "Preferred Workflow" | "Current Tendencies" | "Avoid" | "Stack & Architecture" | "Active Focus" | "Constraints" | "High-Signal Conventions";

export interface MemoryProposal {
	id: string;
	title: string;
	target: MemoryProposalTarget;
	scopeLabel: string;
	source: string;
	status: "pending";
	content: string;
	evidence: string[];
	section?: ProfileProposalSection;
	slug?: string;
	derivedFrom: string[];
	supersedes?: string;
	extends?: string;
	dedupeKey: string;
	sourcePath: string;
	created?: string;
}

export interface MemoryProposalInput {
	title: string;
	target: MemoryProposalTarget;
	scopeLabel: string;
	source: string;
	content: string;
	evidence: string[];
	section?: ProfileProposalSection;
	slug?: string;
	derivedFrom?: string[];
	supersedes?: string;
	extends?: string;
	created?: string;
}

export interface PendingMemoryProposalsState {
	sourcePath: string;
	proposals: MemoryProposal[];
}

export interface PendingMemoryProposalsSummary {
	sourcePath: string;
	total: number;
	byTarget: Record<MemoryProposalTarget, number>;
}

export interface MemoryProposalAction extends MemoryProposalInput {
	action: "approve" | "queue" | "reject";
}

export interface AppliedMemoryProposalActionsResult {
	approved: number;
	queued: number;
	rejected: number;
	changedPaths: string[];
	pendingCount: number;
}

function todayStamp(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

function buildProposalDedupeKey(input: {
	target: MemoryProposalTarget;
	title: string;
	section?: string;
	content: string;
}): string {
	return normalizeForDedupe([input.target, input.title, input.section ?? "", input.content].join(" | "));
}

function nextProposalId(existingIds: string[], date = new Date()): string {
	const stamp = date.toISOString().slice(0, 10).replace(/-/g, "");
	const todays = existingIds
		.map((id) => new RegExp(`^${PROPOSAL_PREFIX}${stamp}-(\\d{3})$`).exec(id)?.[1])
		.filter((value): value is string => Boolean(value))
		.map((value) => Number.parseInt(value, 10))
		.filter((value) => Number.isFinite(value));
	const next = (todays.length === 0 ? 0 : Math.max(...todays)) + 1;
	return `${PROPOSAL_PREFIX}${stamp}-${String(next).padStart(3, "0")}`;
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
			const heading = (headingMatch[1] ?? "").trim();
			current = heading.startsWith(PROPOSAL_PREFIX) ? { heading, lines: [] } : undefined;
			continue;
		}
		if (current) current.lines.push(line);
	}
	if (current) blocks.push(current);
	return blocks;
}

function parseProposal(block: { heading: string; lines: string[] }, sourcePath: string): MemoryProposal {
	const headingMatch = /^(M-\d{8}-\d{3})\s+[—-]\s+(.+)$/.exec(block.heading.trim());
	const id = headingMatch?.[1] ?? block.heading.trim();
	const title = headingMatch?.[2]?.trim() ?? block.heading.trim();
	const metadata = metadataMap(block.lines);
	const sections = parseMarkdownSections([`## ${block.heading}`, ...block.lines].join("\n"));
	const change = (sections.get("change") ?? [])
		.map((line) => line.trim())
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	const evidence = compactLines(
		(sections.get("evidence") ?? [])
			.map((line) => line.replace(/^[-*]\s+/, "").trim())
			.filter(Boolean),
		12,
	);
	const section = metadata.get("section") as ProfileProposalSection | undefined;
	return {
		id,
		title,
		target: (metadata.get("target") as MemoryProposalTarget | undefined) ?? "conventions",
		scopeLabel: metadata.get("scope") ?? "project",
		source: metadata.get("source") ?? "manual",
		status: "pending",
		content: change,
		evidence,
		section,
		slug: metadata.get("slug") || undefined,
		derivedFrom: (metadata.get("derived-from") ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
		supersedes: metadata.get("supersedes") || undefined,
		extends: metadata.get("extends") || undefined,
		dedupeKey: buildProposalDedupeKey({
			target: ((metadata.get("target") as MemoryProposalTarget | undefined) ?? "conventions"),
			title,
			section,
			content: change,
		}),
		sourcePath,
		created: metadata.get("created") || undefined,
	};
}

function renderProposal(proposal: MemoryProposal): string {
	const lines: string[] = [];
	lines.push(`## ${proposal.id} — ${proposal.title}`);
	lines.push("");
	lines.push(`- **Target**: ${proposal.target}`);
	if (proposal.section) lines.push(`- **Section**: ${proposal.section}`);
	lines.push(`- **Scope**: ${proposal.scopeLabel}`);
	lines.push(`- **Source**: ${proposal.source}`);
	lines.push(`- **Status**: pending`);
	lines.push(`- **Created**: ${proposal.created ?? todayStamp()}`);
	if (proposal.slug) lines.push(`- **Slug**: ${proposal.slug}`);
	if (proposal.supersedes) lines.push(`- **Supersedes**: ${proposal.supersedes}`);
	if (proposal.extends) lines.push(`- **Extends**: ${proposal.extends}`);
	if (proposal.derivedFrom.length > 0) lines.push(`- **Derived-from**: ${proposal.derivedFrom.join(", ")}`);
	lines.push("");
	lines.push("### Change");
	lines.push(proposal.content);
	lines.push("");
	lines.push("### Evidence");
	if (proposal.evidence.length === 0) lines.push("- No explicit evidence paths recorded.");
	for (const evidence of proposal.evidence) lines.push(`- ${evidence}`);
	lines.push("");
	return lines.join("\n");
}

function renderPendingProposals(state: PendingMemoryProposalsState): string {
	const lines: string[] = [];
	lines.push("# Pending Memory Proposals");
	lines.push("");
	lines.push(`- **Updated**: ${todayStamp()}`);
	lines.push("- **Policy**: Durable memory and profile writes require explicit questionnaire approval.");
	lines.push("");
	if (state.proposals.length === 0) {
		lines.push("<!-- Pending memory proposals appear below as `## M-YYYYMMDD-NNN — Title`. -->");
		lines.push("");
	} else {
		for (const proposal of [...state.proposals].sort((left, right) => left.id.localeCompare(right.id))) {
			lines.push(renderProposal(proposal).trimEnd());
		}
	}
	lines.push("## Archived Proposals");
	lines.push("");
	lines.push("<!-- Move reviewed or rejected items here as `### M-...` blocks if history is useful. -->");
	lines.push("");
	return lines.join("\n");
}

function mergeEvidence(left: string[], right: string[]): string[] {
	return compactLines([...left, ...right], 12);
}

function toProposal(input: MemoryProposalInput, sourcePath: string, existing?: MemoryProposal): MemoryProposal {
	const content = input.content.trim();
	return {
		id: existing?.id ?? "",
		title: input.title,
		target: input.target,
		scopeLabel: input.scopeLabel,
		source: input.source,
		status: "pending",
		content,
		evidence: mergeEvidence(existing?.evidence ?? [], input.evidence),
		section: input.section ?? existing?.section,
		slug: input.slug ?? existing?.slug,
		derivedFrom: compactLines([...(existing?.derivedFrom ?? []), ...(input.derivedFrom ?? [])], 10),
		supersedes: input.supersedes ?? existing?.supersedes,
		extends: input.extends ?? existing?.extends,
		dedupeKey: buildProposalDedupeKey({
			target: input.target,
			title: input.title,
			section: input.section ?? existing?.section,
			content,
		}),
		sourcePath,
		created: existing?.created ?? input.created ?? todayStamp(),
	};
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "memory-decision";
}

function updateMetadata(raw: string, label: string, value: string): string {
	const pattern = new RegExp(`(^-\\s+\\*\\*${label}\\*\\*:\\s*)(.*)$`, "m");
	if (pattern.test(raw)) return raw.replace(pattern, `$1${value}`);
	const lines = raw.split(/\r?\n/);
	const insertionIndex = Math.min(lines.length, 3);
	lines.splice(insertionIndex, 0, `- **${label}**: ${value}`);
	return lines.join("\n");
}

function ensureTopLevelFile(title: string): string {
	return `# ${title}\n\n- **Updated**: ${todayStamp()}\n\n`;
}

function appendSectionBlock(raw: string, title: string, bodyLines: string[]): string {
	const normalized = raw.trimEnd();
	const lines = [normalized, normalized ? "" : "", `## ${todayStamp()} — ${title}`, "", ...bodyLines, ""];
	return lines.join("\n").replace(/^\n/, "");
}

function bulletExists(lines: string[], bullet: string): boolean {
	const normalized = normalizeForDedupe(bullet);
	return lines.some((line) => line.trim().startsWith("-") && normalizeForDedupe(line.replace(/^[-*]\s+/, "")) === normalized);
}

function upsertBulletSection(raw: string, heading: string, bullet: string): string {
	const source = raw.trimEnd();
	const sectionHeader = `## ${heading}`;
	const start = source.indexOf(sectionHeader);
	if (start === -1) {
		return `${source}\n\n${sectionHeader}\n- ${bullet}\n`;
	}
	const afterHeader = source.indexOf("\n", start);
	const nextHeadingMatch = /\n##\s+/.exec(source.slice(afterHeader + 1));
	const sectionEnd = nextHeadingMatch ? afterHeader + 1 + nextHeadingMatch.index : source.length;
	const before = source.slice(0, afterHeader + 1);
	const sectionBody = source.slice(afterHeader + 1, sectionEnd);
	const after = source.slice(sectionEnd);
	const sectionLines = sectionBody.split(/\r?\n/);
	if (bulletExists(sectionLines, bullet)) return source;
	const trimmedBody = sectionBody.trimEnd();
	const nextBody = trimmedBody ? `${trimmedBody}\n- ${bullet}\n` : `- ${bullet}\n`;
	return `${before}${nextBody}${after}`;
}

function ensureProfileSources(raw: string, evidence: string[]): string {
	if (evidence.length === 0) return raw;
	const lines = raw.split(/\r?\n/);
	const sourcesIndex = lines.findIndex((line) => /^-\s+\*\*Sources\*\*:/.test(line.trim()));
	if (sourcesIndex === -1) return raw;
	const existing = new Set<string>();
	for (let index = sourcesIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (!/^\s+-\s+/.test(line)) break;
		existing.add(line.replace(/^\s+-\s+/, "").trim());
	}
	const additions = compactLines(evidence, 10).filter((item) => !existing.has(item));
	if (additions.length === 0) return raw;
	const insertionIndex = sourcesIndex + 1 + existing.size;
	lines.splice(insertionIndex, 0, ...additions.map((item) => `  - ${item}`));
	return lines.join("\n");
}

async function applyConvention(path: string, proposal: MemoryProposal): Promise<void> {
	let raw = (await readOptionalText(path)) ?? ensureTopLevelFile("Conventions");
	if (raw.includes(`## ${todayStamp()} — ${proposal.title}`) || raw.includes(`## `) && raw.includes(`— ${proposal.title}`)) {
		raw = updateMetadata(raw, "Updated", todayStamp());
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, raw, "utf8");
		return;
	}
	const body = [
		`- Guidance: ${proposal.content}`,
		`- Source: ${proposal.source}`,
		...(proposal.derivedFrom.length > 0 ? [`- Derived-from: ${proposal.derivedFrom.join(", ")}`] : []),
		...(proposal.supersedes ? [`- Supersedes: ${proposal.supersedes}`] : []),
		...(proposal.extends ? [`- Extends: ${proposal.extends}`] : []),
		`- Evidence: ${proposal.evidence.join(" | ") || "none"}`,
	];
		raw = appendSectionBlock(updateMetadata(raw, "Updated", todayStamp()), proposal.title, body);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, raw, "utf8");
}

async function applyPitfall(path: string, proposal: MemoryProposal): Promise<void> {
	let raw = (await readOptionalText(path)) ?? ensureTopLevelFile("Pitfalls");
	if (raw.includes(`— ${proposal.title}`)) {
		raw = updateMetadata(raw, "Updated", todayStamp());
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, raw, "utf8");
		return;
	}
	const body = [
		`- Pitfall: ${proposal.content}`,
		`- Source: ${proposal.source}`,
		...(proposal.derivedFrom.length > 0 ? [`- Derived-from: ${proposal.derivedFrom.join(", ")}`] : []),
		...(proposal.supersedes ? [`- Supersedes: ${proposal.supersedes}`] : []),
		...(proposal.extends ? [`- Extends: ${proposal.extends}`] : []),
		`- Evidence: ${proposal.evidence.join(" | ") || "none"}`,
	];
		raw = appendSectionBlock(updateMetadata(raw, "Updated", todayStamp()), proposal.title, body);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, raw, "utf8");
}

async function applyDecision(decisionsDir: string, proposal: MemoryProposal): Promise<string> {
	const slug = proposal.slug ?? slugify(proposal.title);
	const filename = `${todayStamp()}-${slug}.md`;
	const path = join(decisionsDir, filename);
	const lines: string[] = [];
	lines.push(`# ${todayStamp()} — ${proposal.title}`);
	lines.push("");
	lines.push(`- **Source**: ${proposal.source}`);
	lines.push(`- **Scope**: ${proposal.scopeLabel}`);
	if (proposal.supersedes) lines.push(`- **Supersedes**: ${proposal.supersedes}`);
	if (proposal.extends) lines.push(`- **Extends**: ${proposal.extends}`);
	if (proposal.derivedFrom.length > 0) lines.push(`- **Derived-from**: ${proposal.derivedFrom.join(", ")}`);
	lines.push("");
	lines.push("## Decision");
	lines.push(proposal.content);
	lines.push("");
	lines.push("## Evidence");
	if (proposal.evidence.length === 0) lines.push("- No explicit evidence paths recorded.");
	for (const evidence of proposal.evidence) lines.push(`- ${evidence}`);
	lines.push("");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, lines.join("\n"), "utf8");
	return path;
}

async function applyProfile(path: string, proposal: MemoryProposal, fallbackTitle: string, defaultSection: ProfileProposalSection): Promise<void> {
	let raw = (await readOptionalText(path)) ?? `# ${fallbackTitle}\n\n- **Scope**: ${proposal.scopeLabel}\n- **Updated**: ${todayStamp()}\n- **Sources**:\n\n`;
	raw = ensureProfileSources(raw, proposal.evidence);
	raw = updateMetadata(raw, "Updated", todayStamp());
	raw = upsertBulletSection(raw, proposal.section ?? defaultSection, proposal.content);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, raw.trimEnd() + "\n", "utf8");
}

function targetCounts(proposals: MemoryProposal[]): Record<MemoryProposalTarget, number> {
	return {
		conventions: proposals.filter((proposal) => proposal.target === "conventions").length,
		pitfalls: proposals.filter((proposal) => proposal.target === "pitfalls").length,
		decision: proposals.filter((proposal) => proposal.target === "decision").length,
		"user-profile": proposals.filter((proposal) => proposal.target === "user-profile").length,
		"project-profile": proposals.filter((proposal) => proposal.target === "project-profile").length,
	};
}

export async function loadPendingMemoryProposals(path: string): Promise<PendingMemoryProposalsState | undefined> {
	const raw = await readOptionalText(path);
	if (!raw) return undefined;
	const proposals = parseBlocks(raw).map((block) => parseProposal(block, path));
	return { sourcePath: path, proposals };
}

export function summarizePendingMemoryProposals(state: PendingMemoryProposalsState): PendingMemoryProposalsSummary {
	return {
		sourcePath: state.sourcePath,
		total: state.proposals.length,
		byTarget: targetCounts(state.proposals),
	};
}

export function pendingMemoryProposalsToSnippet(summary: PendingMemoryProposalsSummary): MemorySnippet {
	const lines = [
		`- pending-count: ${summary.total}`,
		`- conventions: ${summary.byTarget.conventions}`,
		`- pitfalls: ${summary.byTarget.pitfalls}`,
		`- decisions: ${summary.byTarget.decision}`,
		`- profiles: ${summary.byTarget["user-profile"] + summary.byTarget["project-profile"]}`,
		"- action: review queued durable/profile proposals, approve via questionnaire, then persist with memory_apply_memory_proposals.",
	].join("\n");
	return {
		kind: "pending-memory-proposals",
		scope: "project",
		sourcePath: summary.sourcePath,
		exists: true,
		title: "Pending Durable/Profile Proposals",
		summary: lines,
		estimatedTokens: estimateTokens(lines),
		priority: 74 + Math.min(summary.total, 6) * 2,
		requiresValidation: false,
		dedupeKey: normalizeForDedupe(`pending-memory-proposals:${summary.sourcePath}:${summary.total}`),
	};
}

export async function writePendingMemoryProposals(path: string, proposals: MemoryProposal[]): Promise<PendingMemoryProposalsState> {
	const state: PendingMemoryProposalsState = { sourcePath: path, proposals };
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, renderPendingProposals(state), "utf8");
	return state;
}

export async function upsertPendingMemoryProposals(path: string, proposals: MemoryProposalInput[]): Promise<PendingMemoryProposalsState> {
	const existing = (await loadPendingMemoryProposals(path)) ?? { sourcePath: path, proposals: [] };
	const byDedupe = new Map(existing.proposals.map((proposal) => [proposal.dedupeKey, proposal]));
	const merged = [...existing.proposals];
	for (const input of proposals) {
		const key = buildProposalDedupeKey({ target: input.target, title: input.title, section: input.section, content: input.content });
		const prior = byDedupe.get(key);
		const proposal = toProposal(input, path, prior);
		if (prior) {
			proposal.id = prior.id;
			const index = merged.findIndex((candidate) => candidate.id === prior.id);
			merged[index] = proposal;
			byDedupe.set(key, proposal);
			continue;
		}
		proposal.id = nextProposalId(merged.map((candidate) => candidate.id));
		merged.push(proposal);
		byDedupe.set(key, proposal);
	}
	return writePendingMemoryProposals(path, merged.sort((left, right) => left.id.localeCompare(right.id)));
}

export async function applyMemoryProposalActions(paths: MemoryPaths, actions: MemoryProposalAction[]): Promise<AppliedMemoryProposalActionsResult> {
	const approve = actions.filter((action) => action.action === "approve");
	const queue = actions.filter((action) => action.action === "queue");
	const reject = actions.filter((action) => action.action === "reject");
	const touchedKeys = new Set(actions.map((action) => buildProposalDedupeKey({ target: action.target, title: action.title, section: action.section, content: action.content })));
	const changedPaths = new Set<string>();

	for (const action of approve) {
		const proposal = toProposal(action, paths.pendingMemoryProposalsPath);
		switch (proposal.target) {
			case "conventions":
				await applyConvention(paths.projectMemoryPaths.conventions, proposal);
				changedPaths.add(paths.projectMemoryPaths.conventions);
				break;
			case "pitfalls":
				await applyPitfall(paths.projectMemoryPaths.pitfalls, proposal);
				changedPaths.add(paths.projectMemoryPaths.pitfalls);
				break;
			case "decision": {
				const path = await applyDecision(paths.projectMemoryPaths.decisionsDir, proposal);
				changedPaths.add(path);
				break;
			}
			case "user-profile":
				await applyProfile(paths.userProfilePath, proposal, "User Profile", "Stable Preferences");
				changedPaths.add(paths.userProfilePath);
				break;
			case "project-profile":
				await applyProfile(paths.projectProfilePath, proposal, "Project Profile", "High-Signal Conventions");
				changedPaths.add(paths.projectProfilePath);
				break;
		}
	}

	const existing = (await loadPendingMemoryProposals(paths.pendingMemoryProposalsPath)) ?? {
		sourcePath: paths.pendingMemoryProposalsPath,
		proposals: [],
	};
	const retained = existing.proposals.filter((proposal) => !touchedKeys.has(proposal.dedupeKey));
	const merged = [...retained];
	const byDedupe = new Map(merged.map((proposal) => [proposal.dedupeKey, proposal]));
	for (const action of queue) {
		const key = buildProposalDedupeKey({ target: action.target, title: action.title, section: action.section, content: action.content });
		const prior = byDedupe.get(key);
		const proposal = toProposal(
			{
				title: action.title,
				target: action.target,
				scopeLabel: action.scopeLabel,
				source: action.source,
				content: action.content,
				evidence: action.evidence,
				section: action.section,
				slug: action.slug,
				derivedFrom: action.derivedFrom,
				supersedes: action.supersedes,
				extends: action.extends,
				created: action.created,
			},
			paths.pendingMemoryProposalsPath,
			prior,
		);
		if (prior) {
			proposal.id = prior.id;
			const index = merged.findIndex((candidate) => candidate.id === prior.id);
			merged[index] = proposal;
			byDedupe.set(key, proposal);
			continue;
		}
		proposal.id = nextProposalId(merged.map((candidate) => candidate.id));
		merged.push(proposal);
		byDedupe.set(key, proposal);
	}
	const nextPending = await writePendingMemoryProposals(
		paths.pendingMemoryProposalsPath,
		merged.sort((left, right) => left.id.localeCompare(right.id)),
	);
	if (approve.length > 0 || queue.length > 0 || reject.length > 0 || existing.proposals.length > 0) {
		changedPaths.add(paths.pendingMemoryProposalsPath);
	}
	return {
		approved: approve.length,
		queued: queue.length,
		rejected: reject.length,
		changedPaths: Array.from(changedPaths),
		pendingCount: nextPending.proposals.length,
	};
}

export function classifyLearningForPromotion(record: LearningRecord): MemoryProposalTarget {
	if (record.category === "mistake-pattern") return "pitfalls";
	if (record.category === "user-preference") return record.scope === "global" ? "user-profile" : "project-profile";
	if (/decision|tradeoff|architecture/i.test(`${record.title} ${record.pattern ?? ""} ${record.recommendation ?? ""}`)) return "decision";
	return "conventions";
}

export function buildPromotionProposalFromLearning(record: LearningRecord, overrides: Partial<MemoryProposalInput> = {}): MemoryProposalInput {
	const target = overrides.target ?? classifyLearningForPromotion(record);
	const defaultSection: ProfileProposalSection | undefined =
		target === "user-profile"
			? "Stable Preferences"
			: target === "project-profile"
				? "High-Signal Conventions"
				: undefined;
	return {
		title: overrides.title ?? record.title,
		target,
		scopeLabel: overrides.scopeLabel ?? record.scopeLabel,
		source: overrides.source ?? `promotion:${record.id}`,
		content: overrides.content ?? record.recommendation ?? record.pattern ?? record.title,
		evidence: compactLines(overrides.evidence ?? record.evidence, 12),
		section: overrides.section ?? defaultSection,
		slug: overrides.slug ?? (target === "decision" ? slugify(record.title) : undefined),
		derivedFrom: overrides.derivedFrom ?? [record.id, ...(record.derivedFrom ?? [])],
		supersedes: overrides.supersedes ?? record.supersedes,
		extends: overrides.extends ?? record.extends,
		created: overrides.created ?? todayStamp(),
	};
}

export function isPromotionEligible(record: LearningRecord): boolean {
	return !record.stale && record.occurrences >= 2 && !record.source.startsWith("scheduled-analysis:");
}

export function decisionPathToTitle(path: string): string {
	return basename(path, ".md");
}
