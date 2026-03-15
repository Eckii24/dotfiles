/**
 * GitHub Copilot Bridge for pi
 *
 * Bridges the repository conventions used by GitHub Copilot into pi:
 *
 * - .github/copilot-instructions.md
 * - .github/instructions/…/*.instructions.md
 * - .github/prompts/…/*.prompt.md
 * - .github/skills/…/SKILL.md
 * - ~/.copilot/skills/…/SKILL.md
 *
 * Changes compared to the original implementation:
 * - Prompt files are exposed through native pi prompt-template discovery so they show up
 *   in the startup [Prompts] section and autocomplete like built-in prompt templates.
 * - Prompt execution is still handled by this extension via the input hook, because
 *   Copilot prompt files support richer ${input:name:prompt} placeholders than pi's
 *   native prompt templates.
 * - Copilot instruction files are surfaced once at startup instead of living in a
 *   persistent widget, so the bridge behaves more like pi's native resource listing.
 * - Startup work is memoized per workspace root so we do not rescan the same trees
 *   multiple times during one startup sequence.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";

interface RepoWideInstruction {
	path: string;
	relativePath: string;
}

interface PathInstruction {
	path: string;
	relativePath: string;
	applyTo: string[];
	excludeAgent?: string;
}

interface PromptVariable {
	name: string;
	prompt: string;
}

interface PromptFile {
	path: string;
	relativePath: string;
	commandName: string;
	description: string;
	body: string;
	variables: PromptVariable[];
	frontmatter: Record<string, string>;
}

interface DiscoveryState {
	root: string;
	repoWideInstruction?: RepoWideInstruction;
	pathInstructions: PathInstruction[];
	promptFiles: Map<string, PromptFile>;
	skillPaths: string[];
	duplicates: string[];
	promptStubPaths: Map<string, string>;
	instructionsBlock?: string;
}

const STUB_DIR_NAME = "pi-github-copilot-bridge";

function fileExists(filePath: string): boolean {
	try {
		return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

function directoryExists(dirPath: string): boolean {
	try {
		return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
	} catch {
		return false;
	}
}

function readTextIfExists(filePath: string): string | undefined {
	try {
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
}

function walkFilesRecursive(dirPath: string, predicate: (filePath: string) => boolean): string[] {
	if (!directoryExists(dirPath)) return [];

	const files: string[] = [];
	const stack = [dirPath];

	while (stack.length > 0) {
		const current = stack.pop()!;
		const entries = fs.readdirSync(current, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.isFile() && predicate(fullPath)) {
				files.push(fullPath);
			}
		}
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function listFiles(dirPath: string, predicate: (filePath: string) => boolean): string[] {
	if (!directoryExists(dirPath)) return [];

	const files: string[] = [];
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const fullPath = path.join(dirPath, entry.name);
		if (predicate(fullPath)) files.push(fullPath);
	}

	return files.sort((a, b) => a.localeCompare(b));
}

function splitFrontmatter(markdown: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	if (!markdown.startsWith("---\n") && !markdown.startsWith("---\r\n")) {
		return { frontmatter: {}, body: markdown.trim() };
	}

	const normalized = markdown.replace(/\r\n/g, "\n");
	const end = normalized.indexOf("\n---\n", 4);
	if (end === -1) {
		return { frontmatter: {}, body: markdown.trim() };
	}

	const rawFrontmatter = normalized.slice(4, end);
	const body = normalized.slice(end + 5).trim();
	const frontmatter: Record<string, string> = {};

	for (const rawLine of rawFrontmatter.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator === -1) continue;

		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		frontmatter[key] = value;
	}

	return { frontmatter, body };
}

function firstNonEmptyLine(text: string): string | undefined {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function sanitizeCommandName(fileName: string): string {
	const withoutSuffix = fileName.replace(/\.prompt\.md$/i, "");
	const sanitized = withoutSuffix
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-_]+|[-_]+$/g, "");

	return sanitized || "copilot-prompt";
}

function extractPromptVariables(body: string): PromptVariable[] {
	const variables: PromptVariable[] = [];
	const seen = new Set<string>();
	const regex = /\$\{input:([a-zA-Z0-9_-]+):([^}]+)\}/g;

	for (const match of body.matchAll(regex)) {
		const name = match[1]?.trim();
		const prompt = match[2]?.trim();
		if (!name || !prompt || seen.has(name)) continue;
		seen.add(name);
		variables.push({ name, prompt });
	}

	return variables;
}

function normalizePromptBody(body: string): string {
	return body
		.replace(/#file:([^\s)\]\r\n]+)/g, "@$1")
		.replace(/#selection\b/g, "the current selection (not available in pi; ask the user for it if needed)");
}

function splitCommaList(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function resolveWorkspaceRoot(startDir: string): string {
	let current = path.resolve(startDir);

	while (true) {
		if (
			directoryExists(path.join(current, ".git")) ||
			fileExists(path.join(current, ".git")) ||
			directoryExists(path.join(current, ".github"))
		) {
			return current;
		}

		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startDir);
		current = parent;
	}
}

function readPromptFile(promptPath: string, root: string): PromptFile {
	const source = fs.readFileSync(promptPath, "utf8");
	const { frontmatter, body } = splitFrontmatter(source);
	const commandName = sanitizeCommandName(path.basename(promptPath));
	const description =
		frontmatter.description?.trim() || firstNonEmptyLine(body) || `Run ${commandName} prompt`;

	return {
		path: promptPath,
		relativePath: path.relative(root, promptPath),
		commandName,
		description,
		body: normalizePromptBody(body),
		variables: extractPromptVariables(body),
		frontmatter,
	};
}

let cachedPersonalSkillPaths: string[] | undefined;

function discoverPersonalSkillPaths(): string[] {
	if (cachedPersonalSkillPaths) return cachedPersonalSkillPaths;
	const personalSkillsDir = path.join(os.homedir(), ".copilot", "skills");
	cachedPersonalSkillPaths = walkFilesRecursive(personalSkillsDir, (filePath) => path.basename(filePath) === "SKILL.md");
	return cachedPersonalSkillPaths;
}

function discover(root: string): DiscoveryState {
	const repoWidePath = path.join(root, ".github", "copilot-instructions.md");
	const pathInstructionsDir = path.join(root, ".github", "instructions");
	const promptDir = path.join(root, ".github", "prompts");
	const projectSkillsDir = path.join(root, ".github", "skills");

	const state: DiscoveryState = {
		root,
		pathInstructions: [],
		promptFiles: new Map<string, PromptFile>(),
		skillPaths: [],
		duplicates: [],
		promptStubPaths: new Map<string, string>(),
	};

	if (fileExists(repoWidePath)) {
		state.repoWideInstruction = {
			path: repoWidePath,
			relativePath: path.relative(root, repoWidePath),
		};
	}

	for (const instructionPath of walkFilesRecursive(pathInstructionsDir, (filePath) => filePath.endsWith(".instructions.md"))) {
		const source = fs.readFileSync(instructionPath, "utf8");
		const { frontmatter } = splitFrontmatter(source);
		const excludeAgent = frontmatter.excludeAgent?.trim();

		// pi behaves closest to Copilot's coding agent, so honor excludeAgent: coding-agent.
		if (excludeAgent === "coding-agent") continue;

		state.pathInstructions.push({
			path: instructionPath,
			relativePath: path.relative(root, instructionPath),
			applyTo: splitCommaList(frontmatter.applyTo),
			excludeAgent,
		});
	}

	// Prompt files live directly in .github/prompts according to GitHub's docs.
	for (const promptPath of listFiles(promptDir, (filePath) => filePath.endsWith(".prompt.md"))) {
		const promptFile = readPromptFile(promptPath, root);

		if (state.promptFiles.has(promptFile.commandName)) {
			state.duplicates.push(
				`Prompt command /${promptFile.commandName} is defined more than once. Keeping ${state.promptFiles.get(promptFile.commandName)?.relativePath} and ignoring ${path.relative(root, promptPath)}.`,
			);
			continue;
		}

		state.promptFiles.set(promptFile.commandName, promptFile);
	}

	for (const skillPath of walkFilesRecursive(projectSkillsDir, (filePath) => path.basename(filePath) === "SKILL.md")) {
		state.skillPaths.push(skillPath);
	}
	state.skillPaths.push(...discoverPersonalSkillPaths());

	state.skillPaths.sort((a, b) => a.localeCompare(b));
	ensurePromptStubs(state);
	return state;
}

function loadRepoWideInstructionBody(instruction: RepoWideInstruction): string {
	return fs.readFileSync(instruction.path, "utf8").trim();
}

function loadPathInstructionBody(instruction: PathInstruction): string {
	const source = fs.readFileSync(instruction.path, "utf8");
	return splitFrontmatter(source).body;
}

function renderInstructionsBlock(state: DiscoveryState): string | undefined {
	if (state.instructionsBlock !== undefined) {
		return state.instructionsBlock || undefined;
	}

	if (!state.repoWideInstruction && state.pathInstructions.length === 0) {
		state.instructionsBlock = "";
		return undefined;
	}

	const parts: string[] = [
		"## GitHub Copilot repository instructions bridge",
		"The following GitHub Copilot instruction files were discovered in this workspace. Treat them as project instructions.",
		"For path-specific instructions, only apply them when working on files that match the documented applyTo patterns.",
	];

	if (state.repoWideInstruction) {
		const body = loadRepoWideInstructionBody(state.repoWideInstruction);
		if (body) {
			parts.push(
				`### Repository-wide instructions (${state.repoWideInstruction.relativePath})`,
				body,
			);
		}
	}

	if (state.pathInstructions.length > 0) {
		parts.push("### Path-specific instructions");
		for (const instruction of state.pathInstructions) {
			const body = loadPathInstructionBody(instruction);
			const applyTo = instruction.applyTo.length > 0 ? instruction.applyTo.join(", ") : "(not specified)";
			const exclude = instruction.excludeAgent ? `\nexcludeAgent: ${instruction.excludeAgent}` : "";
			parts.push(
				`#### ${instruction.relativePath}`,
				`applyTo: ${applyTo}${exclude}`,
				body,
			);
		}
	}

	state.instructionsBlock = parts.join("\n\n");
	return state.instructionsBlock;
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;

	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		const next = input[i + 1];

		if (char === "\\" && next) {
			current += next;
			i++;
			continue;
		}

		if ((char === '"' || char === "'") && (!quote || quote === char)) {
			quote = quote === char ? null : char;
			continue;
		}

		if (!quote && /\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current) tokens.push(current);
	return tokens;
}

function parseArgs(input: string): {
	named: Map<string, string>;
	positional: string[];
} {
	const named = new Map<string, string>();
	const positional: string[] = [];

	for (const token of tokenizeArgs(input.trim())) {
		const separator = token.indexOf("=");
		if (separator > 0) {
			const key = token.slice(0, separator).trim();
			const value = token.slice(separator + 1).trim();
			if (key) {
				named.set(key, value);
				continue;
			}
		}
		positional.push(token);
	}

	return { named, positional };
}

function expandPrompt(promptFile: PromptFile, args: string, resolvedValues: Map<string, string>): string {
	let expanded = promptFile.body.replace(/\$\{input:([a-zA-Z0-9_-]+):([^}]+)\}/g, (_match, name: string) => {
		return resolvedValues.get(name) ?? `[missing input: ${name}]`;
	});

	if (args.trim() && promptFile.variables.length === 0) {
		expanded += `\n\nAdditional command arguments from /${promptFile.commandName}: ${args.trim()}`;
	}

	return [
		`Use the following GitHub Copilot prompt file from ${promptFile.relativePath}.`,
		"",
		expanded.trim(),
	].join("\n");
}

function promptStubsDir(root: string): string {
	const hash = createHash("sha1").update(root).digest("hex");
	return path.join(os.tmpdir(), STUB_DIR_NAME, hash);
}

function yamlQuote(value: string): string {
	return JSON.stringify(value);
}

function promptStubContent(promptFile: PromptFile): string {
	return [
		"---",
		`description: ${yamlQuote(`[Copilot prompt] ${promptFile.description}`)}`,
		"---",
		"This prompt is provided by the GitHub Copilot Bridge extension.",
		"Invocation is handled by the bridge so Copilot-style ${input:name:prompt} placeholders still work.",
	].join("\n");
}

function ensurePromptStubs(state: DiscoveryState): void {
	if (state.promptFiles.size === 0) return;

	const dir = promptStubsDir(state.root);
	fs.mkdirSync(dir, { recursive: true });

	for (const promptFile of state.promptFiles.values()) {
		const stubPath = path.join(dir, `${promptFile.commandName}.md`);
		const content = promptStubContent(promptFile);
		const existing = readTextIfExists(stubPath);
		if (existing !== content) {
			fs.writeFileSync(stubPath, content, "utf8");
		}
		state.promptStubPaths.set(promptFile.commandName, stubPath);
	}
}

function parseSlashCommand(text: string): { commandName: string; args: string } | undefined {
	if (!text.startsWith("/")) return undefined;

	const spaceIndex = text.indexOf(" ");
	if (spaceIndex === -1) {
		return { commandName: text.slice(1), args: "" };
	}

	return {
		commandName: text.slice(1, spaceIndex),
		args: text.slice(spaceIndex + 1),
	};
}

function buildStartupContextMessage(state: DiscoveryState, theme: Theme): string | undefined {
	const lines: string[] = [];

	if (!state.repoWideInstruction && state.pathInstructions.length === 0) {
		return undefined;
	}

	lines.push(theme.fg("mdHeading", "[GitHub Copilot Bridge]"), theme.fg("dim", "Context"));

	if (state.repoWideInstruction) {
		lines.push(theme.fg("dim", `  ${state.repoWideInstruction.relativePath}`));
	}

	for (const instruction of state.pathInstructions) {
		const applyTo = instruction.applyTo.length > 0 ? instruction.applyTo.join(", ") : "all files";
		const excludeAgent = instruction.excludeAgent ? ` (excludeAgent: ${instruction.excludeAgent})` : "";
		lines.push(theme.fg("dim", `  ${instruction.relativePath} → ${applyTo}${excludeAgent}`));
	}

	lines.push("");
	return lines.join("\n");
}

export default function githubCopilotBridge(pi: ExtensionAPI) {
	const stateCache = new Map<string, DiscoveryState>();

	function ensureState(cwd: string, force = false): DiscoveryState {
		const root = resolveWorkspaceRoot(cwd);
		if (force) {
			cachedPersonalSkillPaths = undefined;
			stateCache.delete(root);
		}
		if (!stateCache.has(root)) {
			stateCache.set(root, discover(root));
		}
		return stateCache.get(root)!;
	}

	function isCopilotPromptActive(commandName: string, currentState: DiscoveryState): boolean {
		const stubPath = currentState.promptStubPaths.get(commandName);
		if (!stubPath) return false;

		return pi
			.getCommands()
			.some((command) => command.name === commandName && command.source === "prompt" && command.path === stubPath);
	}

	pi.on("resources_discover", (event) => {
		const currentState = ensureState(event.cwd, event.reason === "reload");
		return {
			skillPaths: currentState.skillPaths,
			promptPaths: Array.from(currentState.promptStubPaths.values()),
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		const currentState = ensureState(ctx.cwd);
		const startupContextMessage = buildStartupContextMessage(currentState, ctx.ui.theme);
		if (startupContextMessage) {
			ctx.ui.notify(startupContextMessage, "info");
		}

		for (const duplicate of currentState.duplicates) {
			ctx.ui.notify(duplicate, "warning");
		}
	});

	pi.on("input", async (event, ctx) => {
		const invocation = parseSlashCommand(event.text);
		if (!invocation) return { action: "continue" as const };

		const currentState = ensureState(ctx.cwd);
		const promptFile = currentState.promptFiles.get(invocation.commandName);
		if (!promptFile) return { action: "continue" as const };
		if (!isCopilotPromptActive(invocation.commandName, currentState)) {
			return { action: "continue" as const };
		}

		const parsedArgs = parseArgs(invocation.args);
		const resolvedValues = new Map<string, string>();
		const missingValues: PromptVariable[] = [];
		let positionalIndex = 0;

		for (const variable of promptFile.variables) {
			const namedValue = parsedArgs.named.get(variable.name);
			if (namedValue !== undefined) {
				resolvedValues.set(variable.name, namedValue);
				continue;
			}

			if (positionalIndex < parsedArgs.positional.length) {
				resolvedValues.set(variable.name, parsedArgs.positional[positionalIndex]);
				positionalIndex++;
				continue;
			}

			missingValues.push(variable);
		}

		if (missingValues.length > 0 && ctx.hasUI) {
			for (const variable of missingValues) {
				const value = await ctx.ui.input(`/${invocation.commandName} → ${variable.name}`, variable.prompt);
				if (value === undefined) {
					return { action: "handled" as const };
				}
				resolvedValues.set(variable.name, value);
			}
		} else {
			for (const variable of missingValues) {
				resolvedValues.set(
					variable.name,
					`[missing input: ${variable.name} — ${variable.prompt}. Ask the user for this if needed.]`,
				);
			}
		}

		return {
			action: "transform" as const,
			text: expandPrompt(promptFile, invocation.args, resolvedValues),
			images: event.images,
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const currentState = ensureState(ctx.cwd);
		const instructionsBlock = renderInstructionsBlock(currentState);
		if (!instructionsBlock) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${instructionsBlock}`,
		};
	});
}
