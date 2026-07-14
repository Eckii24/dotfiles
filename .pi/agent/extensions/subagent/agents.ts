/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { resolveModelReference } from "../shared/model-reference.js";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		let frontmatter: Record<string, unknown>;
		let body: string;
		try {
			({ frontmatter, body } = parseFrontmatter<Record<string, unknown>>(content));
		} catch (error) {
			console.error(`[subagent] Ignoring ${filePath}: invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}

		const name = frontmatter.name;
		const description = frontmatter.description;
		if (typeof name !== "string" || !name.trim() || typeof description !== "string" || !description.trim()) {
			continue;
		}

		const toolsValue = frontmatter.tools;
		if (toolsValue !== undefined && (!Array.isArray(toolsValue) || toolsValue.length === 0 || toolsValue.some((tool) => typeof tool !== "string" || !tool.trim()))) {
			console.error(`[subagent] Ignoring ${filePath}: tools must be a non-empty YAML array of strings`);
			continue;
		}
		const tools = toolsValue?.map((tool) => (tool as string).trim());

		const modelValue = frontmatter.model;
		if (modelValue !== undefined && (typeof modelValue !== "string" || !modelValue.trim())) {
			console.error(`[subagent] Ignoring ${filePath}: model must be a non-empty YAML string`);
			continue;
		}

		let model: string | undefined;
		try {
			model = typeof modelValue === "string" ? resolveModelReference(modelValue.trim()) : undefined;
		} catch (error) {
			console.error(`[subagent] Ignoring ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}

		agents.push({
			name: name.trim(),
			description: description.trim(),
			tools,
			model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Format agents for inclusion in the system prompt.
 * Uses XML format similar to how skills are listed, providing
 * progressive disclosure: only name + description are in context.
 */
export function formatAgentsForPrompt(agents: AgentConfig[]): string {
	if (agents.length === 0) return "";

	const lines = [
		"",
		"",
		"The following subagents are available for task delegation via the `subagent` tool.",
		"Each agent runs in an isolated context window. Choose the right agent based on the task description.",
		"",
		"<available_agents>",
	];

	for (const agent of agents) {
		lines.push("  <agent>");
		lines.push(`    <name>${escapeXml(agent.name)}</name>`);
		lines.push(`    <description>${escapeXml(agent.description)}</description>`);
		lines.push(`    <source>${escapeXml(agent.source)}</source>`);
		lines.push("  </agent>");
	}

	lines.push("</available_agents>");
	return lines.join("\n");
}
