import * as fs from "node:fs";
import * as path from "node:path";

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

const COMMAND_PATTERN = /^[a-z][a-z0-9-]*$/;
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function asStringList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function requireString(frontmatter: Record<string, string>, field: string, filePath: string): string {
	const value = frontmatter[field]?.trim();
	if (!value) throw new Error(`Mode ${filePath} requires frontmatter field: ${field}`);
	return value;
}

function parseScalar(value: string, filePath: string, line: string): string {
	if (value.startsWith('"') && value.endsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
			if (typeof parsed === "string") return parsed;
		} catch {
			// Fall through to the consistent frontmatter error below.
		}
		throw new Error(`Invalid quoted mode frontmatter value in ${filePath}: ${line}`);
	}
	if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
	return value;
}

function parseModeFrontmatter(content: string, filePath: string): { frontmatter: Record<string, string>; body: string } {
	if (!content.startsWith("---\n")) throw new Error(`Mode ${filePath} must start with YAML frontmatter`);
	const closingIndex = content.indexOf("\n---\n", 4);
	if (closingIndex === -1) throw new Error(`Mode ${filePath} has unterminated YAML frontmatter`);
	const frontmatter: Record<string, string> = {};
	for (const line of content.slice(4, closingIndex).split("\n")) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0) throw new Error(`Invalid mode frontmatter line in ${filePath}: ${line}`);
		const key = line.slice(0, separator).trim();
		const value = parseScalar(line.slice(separator + 1).trim(), filePath, line);
		if (!key || !value) throw new Error(`Invalid mode frontmatter line in ${filePath}: ${line}`);
		frontmatter[key] = value;
	}
	return { frontmatter, body: content.slice(closingIndex + "\n---\n".length) };
}

function parseMode(filePath: string): ModeDefinition {
	const content = fs.readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseModeFrontmatter(content, filePath);
	const command = requireString(frontmatter, "command", filePath);
	if (!COMMAND_PATTERN.test(command)) {
		throw new Error(`Invalid mode command in ${filePath}: ${command}`);
	}
	const model = frontmatter.model?.trim();
	const tools = frontmatter.tools === undefined ? undefined : asStringList(frontmatter.tools);
	if (tools && tools.length === 0) throw new Error(`Mode ${filePath} tools must not be empty`);
	const thinking = frontmatter.thinking?.trim();
	if (thinking && !THINKING_LEVELS.has(thinking)) {
		throw new Error(`Invalid mode thinking level in ${filePath}: ${thinking}`);
	}

	return {
		command,
		description: frontmatter.description?.trim() || `Activate ${command} mode`,
		model,
		tools: tools && [...new Set(tools)],
		skills: frontmatter.skills === undefined ? undefined : [...new Set(asStringList(frontmatter.skills))],
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
