import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
	ApprovedLearningFrontmatter,
	CollisionInfo,
	CreateLearningResult,
	LearningDocument,
	LearningScope,
	LearningStatus,
	LearningSystemPaths,
	PendingLearningCandidate,
	PendingLearningFrontmatter,
} from "./contracts.js";
import { normalizeIsoDate, todayIso } from "./contracts.js";
import { collapseWhitespace, ensureStructuredLearningBody, readOptionalText, renderFrontmatter, splitFrontmatter } from "./markdown.js";

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"against",
	"any",
	"as",
	"at",
	"be",
	"before",
	"by",
	"can",
	"do",
	"each",
	"for",
	"from",
	"how",
	"if",
	"in",
	"into",
	"is",
	"it",
	"its",
	"non",
	"of",
	"on",
	"or",
	"out",
	"should",
	"so",
	"than",
	"that",
	"the",
	"their",
	"them",
	"then",
	"this",
	"those",
	"through",
	"to",
	"use",
	"using",
	"when",
	"where",
	"with",
]);

const LOW_SIGNAL_WORDS = new Set([
	"again",
	"always",
	"another",
	"awkward",
	"better",
	"body",
	"clear",
	"clearly",
	"correct",
	"deleting",
	"derived",
	"details",
	"existing",
	"first",
	"explicit",
	"facts",
	"file",
	"files",
	"guidance",
	"help",
	"live",
	"low",
	"many",
	"meaningful",
	"most",
	"multi",
	"multiple",
	"normal",
	"now",
	"not",
	"rely",
	"relying",
	"risk",
	"same",
	"signal",
	"simple",
	"single",
	"instead",
	"stop",
	"straightforward",
	"strict",
	"stronger",
	"safely",
	"task",
	"tasks",
	"them",
	"there",
	"well",
	"work",
]);

const DIRECTIVE_PRIORITY = [
	"validate",
	"delegate",
	"prefer",
	"keep",
	"avoid",
	"review",
	"normalize",
	"promote",
	"merge",
	"compact",
	"scan",
	"write",
	"remove",
	"delete",
	"move",
	"check",
	"treat",
	"apply",
	"create",
	"use",
] as const;

const DIRECTIVE_RANK = new Map(DIRECTIVE_PRIORITY.map((word, index) => [word, DIRECTIVE_PRIORITY.length - index]));
const SPECIAL_BIGRAMS = new Map<string, string>([
	["sub agent", "sub-agents"],
	["sub agents", "sub-agents"],
	["current work", "current-work"],
]);

interface SummaryWord {
	value: string;
	index: number;
	clauseIndex: number;
}

function tokenizeSummary(summary: string): SummaryWord[] {
	const clauses = summary
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/[–—]+/g, " | ")
		.replace(/[()\[\]{}:;,.!?/]+/g, " ")
		.replace(/-/g, " ")
		.split("|")
		.map((clause) => clause.trim())
		.filter(Boolean);
	const tokens: SummaryWord[] = [];
	let index = 0;
	for (const [clauseIndex, clause] of clauses.entries()) {
		const words = clause.match(/[a-z0-9]+/g) ?? [];
		for (const word of words) {
			tokens.push({ value: word, index, clauseIndex });
			index += 1;
		}
	}
	return combineSpecialBigrams(tokens);
}

function combineSpecialBigrams(words: SummaryWord[]): SummaryWord[] {
	const combined: SummaryWord[] = [];
	for (let index = 0; index < words.length; index += 1) {
		const current = words[index];
		const next = words[index + 1];
		if (!current) continue;
		if (next && current.clauseIndex === next.clauseIndex) {
			const bigram = `${current.value} ${next.value}`;
			const replacement = SPECIAL_BIGRAMS.get(bigram);
			if (replacement) {
				combined.push({ value: replacement, index: current.index, clauseIndex: current.clauseIndex });
				index += 1;
				continue;
			}
		}
		combined.push(current);
	}
	return combined;
}

function isDirectiveWord(word: string): boolean {
	return DIRECTIVE_RANK.has(word);
}

function isNumericWord(word: string): boolean {
	return /^\d+$/.test(word);
}

function wordCount(value: string): number {
	return value.split("-").filter(Boolean).length;
}

function chooseAnchor(words: SummaryWord[]): SummaryWord | undefined {
	const directives = words.filter((word) => isDirectiveWord(word.value));
	if (directives.length > 0) {
		return directives.sort((a, b) => {
			const rankDiff = (DIRECTIVE_RANK.get(b.value) ?? 0) - (DIRECTIVE_RANK.get(a.value) ?? 0);
			if (rankDiff !== 0) return rankDiff;
			return a.index - b.index;
		})[0];
	}
	return words[0];
}

function scoreSupportWord(word: SummaryWord, anchor: SummaryWord): number {
	let score = 1;
	if (word.clauseIndex < anchor.clauseIndex) score += 2.5;
	else if (word.clauseIndex === anchor.clauseIndex) score += word.index > anchor.index ? 1.2 : 0.5;
	if (word.index <= 4) score += 0.9;
	if (word.value.length >= 7) score += 0.6;
	else if (word.value.length >= 5) score += 0.3;
	if (LOW_SIGNAL_WORDS.has(word.value)) score -= 1.5;
	if (isDirectiveWord(word.value)) score -= 1;
	if (word.value.endsWith("ing")) score -= 0.3;
	return score;
}

export function slugFromSummary(summary: string): string {
	const words = tokenizeSummary(summary);
	const nonNumeric = words.filter((word) => !isNumericWord(word.value));
	const filtered = nonNumeric.filter((word) => !STOP_WORDS.has(word.value));
	const candidatePool = filtered.length > 0 ? filtered : nonNumeric.length > 0 ? nonNumeric : words;
	const candidates = candidatePool.filter((word) => !LOW_SIGNAL_WORDS.has(word.value) || isDirectiveWord(word.value));
	const anchorPool = candidates.length > 0 ? candidates : candidatePool;
	const anchor = chooseAnchor(anchorPool);
	if (!anchor) return "learning";

	const parts = [anchor.value];
	const seen = new Set(parts);
	const preferredWordCount = isDirectiveWord(anchor.value) ? 3 : 4;
	const supportWords = anchorPool
		.filter((word) => !(word.index === anchor.index && word.clauseIndex === anchor.clauseIndex))
		.sort((a, b) => scoreSupportWord(b, anchor) - scoreSupportWord(a, anchor) || a.index - b.index);

	for (const support of supportWords) {
		if (seen.has(support.value)) continue;
		const nextCount = parts.reduce((total, part) => total + wordCount(part), 0) + wordCount(support.value);
		if (nextCount > 5) continue;
		if (parts.length >= 2 && scoreSupportWord(support, anchor) < 1.1) break;
		parts.push(support.value);
		seen.add(support.value);
		const currentCount = parts.reduce((total, part) => total + wordCount(part), 0);
		if (currentCount >= preferredWordCount) break;
	}

	const slug = parts.join("-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return isValidLearningSlug(slug) ? slug : "learning";
}

export function isValidLearningSlug(slug: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/.test(slug);
}

function learningDir(paths: LearningSystemPaths, scope: LearningScope, status: LearningStatus): string {
	if (scope === "global") return status === "pending" ? paths.globalPendingDir : paths.globalDir;
	return status === "pending" ? paths.projectPendingDir : paths.projectDir;
}

function parseApprovedFrontmatter(frontmatter: Record<string, string>): ApprovedLearningFrontmatter {
	const keys = Object.keys(frontmatter).sort();
	const expected = ["created", "lastReviewed", "summary"].sort();
	if (JSON.stringify(keys) !== JSON.stringify(expected)) {
		throw new Error(`Invalid approved learning frontmatter fields: ${keys.join(", ") || "none"}`);
	}
	return {
		created: normalizeIsoDate(frontmatter.created),
		lastReviewed: normalizeIsoDate(frontmatter.lastReviewed, normalizeIsoDate(frontmatter.created)),
		summary: collapseWhitespace(frontmatter.summary),
	};
}

function parsePendingFrontmatter(frontmatter: Record<string, string>): PendingLearningFrontmatter {
	const keys = Object.keys(frontmatter).sort();
	const expected = ["created", "summary"].sort();
	if (JSON.stringify(keys) !== JSON.stringify(expected)) {
		throw new Error(`Invalid pending learning frontmatter fields: ${keys.join(", ") || "none"}`);
	}
	return {
		created: normalizeIsoDate(frontmatter.created),
		summary: collapseWhitespace(frontmatter.summary),
	};
}

function fallbackSummaryFromPath(path: string): string {
	return basename(path, ".md").replace(/-/g, " ").trim() || "learning";
}

function normalizeApprovedFrontmatter(
	frontmatter: Record<string, string>,
	summary: string,
	options: { reviewedAt?: string; preserveLastReviewed?: boolean } = {},
): ApprovedLearningFrontmatter {
	const reviewedAt = normalizeIsoDate(options.reviewedAt, todayIso());
	const created = normalizeIsoDate(collapseWhitespace(frontmatter.created ?? reviewedAt) || reviewedAt, reviewedAt);
	const lastReviewed = options.preserveLastReviewed
		? normalizeIsoDate(collapseWhitespace(frontmatter.lastReviewed ?? frontmatter.created ?? reviewedAt) || reviewedAt, created)
		: reviewedAt;
	return {
		created,
		lastReviewed,
		summary,
	};
}

function normalizePendingFrontmatter(frontmatter: Record<string, string>, summary: string, createdAt = todayIso()): PendingLearningFrontmatter {
	const normalizedCreatedAt = normalizeIsoDate(createdAt, todayIso());
	return {
		created: normalizeIsoDate(collapseWhitespace(frontmatter.created ?? normalizedCreatedAt) || normalizedCreatedAt, normalizedCreatedAt),
		summary,
	};
}

export async function readLearningDocument(path: string, scope: LearningScope, status: "approved"): Promise<LearningDocument<ApprovedLearningFrontmatter>>;
export async function readLearningDocument(path: string, scope: LearningScope, status: "pending"): Promise<LearningDocument<PendingLearningFrontmatter>>;
export async function readLearningDocument(path: string, scope: LearningScope, status: LearningStatus): Promise<LearningDocument> {
	const raw = await readOptionalText(path);
	if (raw === undefined) throw new Error(`Learning not found: ${path}`);
	const { frontmatter, body } = splitFrontmatter(raw);
	const parsed = status === "approved" ? parseApprovedFrontmatter(frontmatter) : parsePendingFrontmatter(frontmatter);
	return {
		path,
		filename: basename(path),
		scope,
		status,
		frontmatter: parsed,
		body,
		rawFrontmatter: frontmatter,
	};
}

export async function readNormalizedLearningDocument(path: string, scope: LearningScope, status: "approved", options?: {
	reviewedAt?: string;
	preserveLastReviewed?: boolean;
}): Promise<LearningDocument<ApprovedLearningFrontmatter>>;
export async function readNormalizedLearningDocument(path: string, scope: LearningScope, status: "pending", options?: {
	reviewedAt?: string;
	preserveLastReviewed?: boolean;
}): Promise<LearningDocument<PendingLearningFrontmatter>>;
export async function readNormalizedLearningDocument(
	path: string,
	scope: LearningScope,
	status: LearningStatus,
	options: { reviewedAt?: string; preserveLastReviewed?: boolean } = {},
): Promise<LearningDocument> {
	const raw = await readOptionalText(path);
	if (raw === undefined) throw new Error(`Learning not found: ${path}`);
	const { frontmatter, body } = splitFrontmatter(raw);
	const summary = collapseWhitespace(frontmatter.summary ?? fallbackSummaryFromPath(path)) || "learning";
	const normalizedBody = ensureStructuredLearningBody(body, summary);
	const normalizedFrontmatter = status === "approved"
		? normalizeApprovedFrontmatter(frontmatter, summary, options)
		: normalizePendingFrontmatter(frontmatter, summary, options.reviewedAt ?? todayIso());
	return {
		path,
		filename: basename(path),
		scope,
		status,
		frontmatter: normalizedFrontmatter,
		body: normalizedBody,
		rawFrontmatter: frontmatter,
	};
}

function renderLearningFile(frontmatter: Record<string, string>, body: string, fieldOrder: string[]): string {
	const renderedFrontmatter = renderFrontmatter(frontmatter, fieldOrder);
	const normalizedBody = body.trim();
	return `${renderedFrontmatter}\n\n${normalizedBody}\n`;
}

export async function writePendingLearning(
	paths: LearningSystemPaths,
	candidate: PendingLearningCandidate,
): Promise<CreateLearningResult> {
	const scope = candidate.scope ?? "project";
	const slug = slugFromSummary(candidate.summary);
	const filename = `${slug}.md`;
	const pendingDir = learningDir(paths, scope, "pending");
	const approvedDir = learningDir(paths, scope, "approved");
	const collision = await findSlugCollision(paths, slug, scope, [
		{ dir: pendingDir, status: "pending" },
		{ dir: approvedDir, status: "approved" },
	]);
	if (collision) return { status: "collision", filename, collision };

	await mkdir(pendingDir, { recursive: true });
	const filePath = join(pendingDir, filename);
	const content = renderLearningFile(
		{
			created: candidate.created ?? todayIso(),
			summary: collapseWhitespace(candidate.summary),
		},
		ensureStructuredLearningBody(candidate.body, candidate.summary),
		["created", "summary"],
	);
	await writeFile(filePath, content, "utf8");
	return { status: "created", path: filePath, filename };
}

export async function approvePendingLearning(
	paths: LearningSystemPaths,
	input: { path: string; fromScope: LearningScope; toScope: LearningScope; reviewedAt?: string },
): Promise<CreateLearningResult> {
	const pending = await readNormalizedLearningDocument(input.path, input.fromScope, "pending", {
		reviewedAt: input.reviewedAt,
	});
	const slug = slugFromSummary(pending.frontmatter.summary);
	const filename = `${slug}.md`;
	const approvedDir = learningDir(paths, input.toScope, "approved");
	const collision = await findSlugCollision(paths, slug, input.toScope, [{ dir: approvedDir, status: "approved" }], input.path);
	if (collision) return { status: "collision", filename, collision };

	await mkdir(approvedDir, { recursive: true });
	const targetPath = join(approvedDir, filename);
	const content = renderLearningFile(
		{
			created: pending.frontmatter.created,
			lastReviewed: input.reviewedAt ?? todayIso(),
			summary: pending.frontmatter.summary,
		},
		pending.body,
		["created", "lastReviewed", "summary"],
	);
	await writeFile(targetPath, content, "utf8");
	await unlink(input.path);
	return { status: "created", path: targetPath, filename };
}

export async function moveApprovedLearning(
	paths: LearningSystemPaths,
	input: { path: string; fromScope: LearningScope; toScope: LearningScope; reviewedAt?: string },
): Promise<CreateLearningResult> {
	if (input.fromScope === input.toScope) {
		throw new Error(`moveApprovedLearning requires different scopes: ${input.fromScope}`);
	}
	const learning = await readNormalizedLearningDocument(input.path, input.fromScope, "approved", {
		reviewedAt: input.reviewedAt,
	});
	const slug = slugFromSummary(learning.frontmatter.summary);
	const filename = `${slug}.md`;
	const targetDir = learningDir(paths, input.toScope, "approved");
	const collision = await findSlugCollision(paths, slug, input.toScope, [{ dir: targetDir, status: "approved" }], input.path);
	if (collision) return { status: "collision", filename, collision };

	await mkdir(targetDir, { recursive: true });
	const targetPath = join(targetDir, filename);
	const content = renderLearningFile(
		{
			created: learning.frontmatter.created,
			lastReviewed: input.reviewedAt ?? todayIso(),
			summary: learning.frontmatter.summary,
		},
		learning.body,
		["created", "lastReviewed", "summary"],
	);
	await writeFile(targetPath, content, "utf8");
	await unlink(input.path);
	return { status: "created", path: targetPath, filename };
}

export async function touchReviewedLearning(path: string, scope: LearningScope, reviewedAt = todayIso()): Promise<void> {
	const learning = await readNormalizedLearningDocument(path, scope, "approved", {
		reviewedAt,
	});
	const content = renderLearningFile(
		{
			created: learning.frontmatter.created,
			lastReviewed: reviewedAt,
			summary: learning.frontmatter.summary,
		},
		learning.body,
		["created", "lastReviewed", "summary"],
	);
	await writeFile(path, content, "utf8");
}

export async function overwriteLearningDocument(document: LearningDocument): Promise<void> {
	const fieldOrder = document.status === "approved" ? ["created", "lastReviewed", "summary"] : ["created", "summary"];
	const content = renderLearningFile(document.frontmatter as Record<string, string>, document.body, fieldOrder);
	await writeFile(document.path, content, "utf8");
}

export async function deleteLearning(path: string): Promise<void> {
	await unlink(path);
}

export async function renameLearning(path: string, nextPath: string): Promise<void> {
	await mkdir(dirname(nextPath), { recursive: true });
	await rename(path, nextPath);
}

export async function findSlugCollision(
	paths: LearningSystemPaths,
	slug: string,
	scope: LearningScope,
	locations?: Array<{ dir: string; status: LearningStatus }>,
	excludePath?: string,
): Promise<CollisionInfo | undefined> {
	const dirs = locations ?? [
		{ dir: learningDir(paths, scope, "pending"), status: "pending" },
		{ dir: learningDir(paths, scope, "approved"), status: "approved" },
	];
	for (const location of dirs) {
		const path = join(location.dir, `${slug}.md`);
		if (excludePath && path === excludePath) continue;
		const text = await readOptionalText(path);
		if (text === undefined) continue;
		return {
			slug,
			path,
			filename: `${slug}.md`,
			scope,
			status: location.status,
		};
	}
	return undefined;
}
