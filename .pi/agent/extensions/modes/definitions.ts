import * as fs from "node:fs";
import * as path from "node:path";
import { parseDocument } from "yaml";

export interface ModeDefinition {
	command: string;
	description: string;
	/** Omitted means retain the active session model. */
	model?: string;
	/** Omitted means retain the active session tool allowlist. */
	tools?: string[];
	/** Omitted means retain all skills already active in the session. */
	skills?: string[];
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	systemPrompt: string;
	filePath: string;
}

export interface ModeSkill {
	name: string;
	filePath: string;
}

type Frontmatter = Record<string, unknown>;

const COMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function isRecord(value: unknown): value is Frontmatter {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(frontmatter: Frontmatter, field: string, filePath: string): string {
	const value = frontmatter[field];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Mode ${filePath} requires frontmatter string field: ${field}`);
	}
	return value.trim();
}

function optionalString(frontmatter: Frontmatter, field: string, filePath: string): string | undefined {
	const value = frontmatter[field];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Mode ${filePath} ${field} must be a non-empty YAML string`);
	}
	return value.trim();
}

function stringList(frontmatter: Frontmatter, field: "tools" | "skills", filePath: string): string[] | undefined {
	const value = frontmatter[field];
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error(`Mode ${filePath} ${field} must be a YAML array of strings`);
	}
	return [...new Set(value.map((item) => item.trim()))];
}

function parseModeFrontmatter(content: string, filePath: string): { frontmatter: Frontmatter; body: string } {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---\n")) throw new Error(`Mode ${filePath} must start with YAML frontmatter`);
	const closingIndex = normalized.indexOf("\n---\n", 4);
	if (closingIndex === -1) throw new Error(`Mode ${filePath} has unterminated YAML frontmatter`);

	const document = parseDocument(normalized.slice(4, closingIndex), { prettyErrors: false, uniqueKeys: true });
	if (document.errors.length > 0) {
		throw new Error(`Invalid YAML frontmatter in ${filePath}: ${document.errors.map((error) => error.message).join("; ")}`);
	}
	const frontmatter = document.toJS();
	if (!isRecord(frontmatter)) throw new Error(`Mode ${filePath} frontmatter must be a YAML mapping`);
	return { frontmatter, body: normalized.slice(closingIndex + "\n---\n".length) };
}

function parseMode(filePath: string): ModeDefinition {
	const content = fs.readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseModeFrontmatter(content, filePath);
	const command = requireString(frontmatter, "command", filePath);
	if (!COMMAND_PATTERN.test(command)) {
		throw new Error(`Invalid mode command in ${filePath}: ${command}`);
	}
	const model = optionalString(frontmatter, "model", filePath);
	const tools = stringList(frontmatter, "tools", filePath);
	if (tools && tools.length === 0) throw new Error(`Mode ${filePath} tools must not be empty`);
	const thinking = optionalString(frontmatter, "thinking", filePath);
	if (thinking && !THINKING_LEVELS.has(thinking)) {
		throw new Error(`Invalid mode thinking level in ${filePath}: ${thinking}`);
	}

	return {
		command,
		description: optionalString(frontmatter, "description", filePath) || `Activate ${command} mode`,
		model,
		tools,
		skills: stringList(frontmatter, "skills", filePath),
		thinking: thinking as ModeDefinition["thinking"],
		systemPrompt: body.trim(),
		filePath,
	};
}

export function loadModes(modesDir: string): ModeDefinition[] {
	if (!fs.existsSync(modesDir)) return [];
	const modes: ModeDefinition[] = [];
	const commands = new Set<string>();
	for (const entry of fs.readdirSync(modesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
		const mode = parseMode(path.join(modesDir, entry.name));
		if (commands.has(mode.command)) throw new Error(`Duplicate mode command: "${mode.command}"`);
		commands.add(mode.command);
		modes.push(mode);
	}
	return modes;
}

export function resolveRequestedSkills<T extends ModeSkill>(requested: string[], available: readonly T[]): T[] {
	return requested.map((name) => {
		const matches = available.filter((skill) => skill.name === name);
		if (matches.length === 0) throw new Error(`Mode requests unavailable skill: "${name}"`);
		if (matches.length > 1) throw new Error(`Mode skill is ambiguous: "${name}"`);
		return matches[0];
	});
}

/** Omitted `skills` preserves Pi's normal discovered-skill index. */
export function selectModeSkills<T extends ModeSkill>(requested: string[] | undefined, available: readonly T[]): T[] {
	return requested === undefined ? [...available] : resolveRequestedSkills(requested, available);
}

/** Replace Pi's metadata-only skill index. Never read or inject SKILL.md bodies. */
export function replaceSkillIndex(systemPrompt: string, availableSkillIndex: string, selectedSkillIndex: string): string {
	if (!availableSkillIndex) return systemPrompt;
	const index = systemPrompt.indexOf(availableSkillIndex);
	if (index === -1) throw new Error("Mode skill index was not found in Pi's system prompt");
	return `${systemPrompt.slice(0, index)}${selectedSkillIndex}${systemPrompt.slice(index + availableSkillIndex.length)}`;
}
