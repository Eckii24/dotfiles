import { existsSync } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { ConfiguredSource, FrontmatterEntry, FrontmatterInjection, FrontmatterRuntimeState, ResolvedSource, SourceSection } from "./contracts.js";
import { hashText } from "./contracts.js";

const TEMPLATE_FILE = "INJECT.md";
const PLACEHOLDER = "{{frontmatter_injector_entries}}";
const FRONTMATTER_BOUNDARY = "---";

function normalizeForDisplay(path: string): string {
	return path.replace(/\\/g, "/");
}

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function splitFrontmatter(text: string): { frontmatter: Record<string, string>; body: string } {
	if (!text.startsWith(`${FRONTMATTER_BOUNDARY}\n`) && !text.startsWith(`${FRONTMATTER_BOUNDARY}\r\n`)) {
		return { frontmatter: {}, body: text };
	}

	const normalized = text.replace(/\r\n/g, "\n");
	const end = normalized.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, FRONTMATTER_BOUNDARY.length + 1);
	if (end === -1) return { frontmatter: {}, body: text };

	const rawFrontmatter = normalized.slice(FRONTMATTER_BOUNDARY.length + 1, end);
	const body = normalized.slice(end + (`\n${FRONTMATTER_BOUNDARY}\n`).length);
	const frontmatter: Record<string, string> = {};
	for (const rawLine of rawFrontmatter.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.+)$/.exec(line);
		if (!match) continue;
		frontmatter[match[1]] = stripQuotes(match[2].trim());
	}
	return { frontmatter, body };
}

function isMarkdownFile(path: string): boolean {
	const lower = path.toLowerCase();
	return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function isWithinRoot(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function toProjectRelativeOrAbsolute(sessionRoot: string, filePath: string): string {
	const rel = relative(sessionRoot, filePath);
	if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
		return normalizeForDisplay(rel);
	}
	return normalizeForDisplay(filePath);
}

async function resolveSource(configured: ConfiguredSource, sessionRoot: string): Promise<{ source?: ResolvedSource; warning?: string }> {
	const resolvedPath = isAbsolute(configured.path) ? resolve(configured.path) : resolve(sessionRoot, configured.path);
	const label = basename(resolvedPath) || resolvedPath;
	if (!existsSync(resolvedPath)) {
		if (isAbsolute(configured.path)) {
			return { warning: `[frontmatter-injector] Configured absolute folder does not exist: ${configured.path}` };
		}
		return {};
	}

	const info = await stat(resolvedPath).catch(() => undefined);
	if (!info?.isDirectory()) {
		return { warning: `[frontmatter-injector] Configured path is not a directory: ${configured.path}` };
	}

	const canonicalPath = await realpath(resolvedPath).catch(() => resolvedPath);
	return {
		source: {
			configuredPath: configured.path,
			resolvedPath: canonicalPath,
			label,
			templatePath: join(canonicalPath, TEMPLATE_FILE),
		},
	};
}

function detectOverlap(current: ResolvedSource, previous: ResolvedSource): boolean {
	if (current.resolvedPath === previous.resolvedPath) return true;
	return isWithinRoot(previous.resolvedPath, current.resolvedPath) || isWithinRoot(current.resolvedPath, previous.resolvedPath);
}

async function collectMarkdownFiles(dir: string, templatePath: string): Promise<string[]> {
	const files: string[] = [];
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectMarkdownFiles(fullPath, templatePath));
			continue;
		}
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		if (entry.name === TEMPLATE_FILE) continue;
		if (resolve(fullPath) === resolve(templatePath)) continue;
		if (!isMarkdownFile(fullPath)) continue;
		files.push(fullPath);
	}
	return files;
}

async function buildEntries(source: ResolvedSource, sessionRoot: string, seenFiles: Set<string>): Promise<FrontmatterEntry[]> {
	const files = await collectMarkdownFiles(source.resolvedPath, source.templatePath);
	const entries: FrontmatterEntry[] = [];
	for (const filePath of files) {
		const canonicalFile = await realpath(filePath).catch(() => resolve(filePath));
		if (seenFiles.has(canonicalFile)) continue;
		const content = await readFile(canonicalFile, "utf8").catch(() => undefined);
		if (!content) continue;
		const { frontmatter } = splitFrontmatter(content);
		const description = collapseWhitespace(frontmatter.description ?? "");
		if (!description) continue;
		seenFiles.add(canonicalFile);
		entries.push({
			path: canonicalFile,
			sourceRelativePath: normalizeForDisplay(relative(source.resolvedPath, canonicalFile)),
			displayPath: toProjectRelativeOrAbsolute(sessionRoot, canonicalFile),
			description,
		});
	}
	entries.sort((a, b) => a.sourceRelativePath.localeCompare(b.sourceRelativePath));
	return entries;
}

function renderEntries(entries: FrontmatterEntry[]): string {
	return entries.map((entry) => `- ${entry.displayPath} — ${entry.description}`).join("\n");
}

async function renderSection(source: ResolvedSource, entries: FrontmatterEntry[], warnings: string[]): Promise<SourceSection> {
	const renderedEntries = renderEntries(entries);
	const template = await readFile(source.templatePath, "utf8").catch(() => undefined);
	let content: string;
	if (!template) {
		content = `## ${source.label}\n\n${renderedEntries}`;
	} else if (template.includes(PLACEHOLDER)) {
		content = template.split(PLACEHOLDER).join(renderedEntries);
	} else {
		warnings.push(`[frontmatter-injector] ${source.templatePath} is missing ${PLACEHOLDER}; appending generated entries to the end.`);
		content = `${template.trimEnd()}\n\n${renderedEntries}`;
	}
	return {
		configuredPath: source.configuredPath,
		resolvedPath: source.resolvedPath,
		label: source.label,
		content: content.trim(),
		entries,
	};
}

function buildInjection(sections: SourceSection[]): FrontmatterInjection | undefined {
	const totalRefs = sections.reduce((sum, section) => sum + section.entries.length, 0);
	if (totalRefs === 0) return undefined;
	const header = `Memory · frontmatter refs · ${totalRefs} ref${totalRefs === 1 ? "" : "s"}`;
	const content = [
		header,
		"Treat frontmatter refs as hints; validate live workspace facts before relying on them.",
		...sections.map((section) => section.content),
	].join("\n\n");
	return {
		header,
		content,
		hash: hashText(content),
		totalRefs,
		sections,
	};
}

export async function buildFrontmatterRuntimeState(sessionRoot: string, configuredSources: ConfiguredSource[]): Promise<FrontmatterRuntimeState> {
	const canonicalSessionRoot = await realpath(sessionRoot).catch(() => resolve(sessionRoot));
	const warnings: string[] = [];
	const resolvedSources: ResolvedSource[] = [];
	for (const configured of configuredSources) {
		const { source, warning } = await resolveSource(configured, canonicalSessionRoot);
		if (warning) warnings.push(warning);
		if (!source) continue;
		const overlap = resolvedSources.find((previous) => detectOverlap(source, previous));
		if (overlap) {
			warnings.push(`[frontmatter-injector] Overlapping configured folders detected: ${source.configuredPath} overlaps with ${overlap.configuredPath}. First-configured-folder wins for duplicate files.`);
		}
		resolvedSources.push(source);
	}

	const sections: SourceSection[] = [];
	const seenFiles = new Set<string>();
	for (const source of resolvedSources) {
		const entries = await buildEntries(source, canonicalSessionRoot, seenFiles);
		if (entries.length === 0) continue;
		sections.push(await renderSection(source, entries, warnings));
	}

	return {
		sessionRoot,
		configuredSources,
		sections,
		warnings,
		injection: buildInjection(sections),
	};
}
