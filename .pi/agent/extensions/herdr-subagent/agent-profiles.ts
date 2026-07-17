/** Independent Herdr subagent profile discovery. */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { resolveModelReference } from "../shared/model-reference.js";

export type AgentScope = "user" | "project" | "both";

export interface AgentProfile {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentProfileDiscoveryResult {
	agents: AgentProfile[];
	projectAgentsDir: string | null;
}

function loadProfilesFromDir(dir: string, source: AgentProfile["source"]): AgentProfile[] {
	if (!fs.existsSync(dir)) return [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const agents: AgentProfile[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
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
		} catch {
			continue;
		}

		const name = frontmatter.name;
		const description = frontmatter.description;
		if (typeof name !== "string" || !name.trim() || typeof description !== "string" || !description.trim()) continue;

		const toolsValue = frontmatter.tools;
		if (toolsValue !== undefined && (!Array.isArray(toolsValue) || toolsValue.length === 0 || toolsValue.some(tool => typeof tool !== "string" || !tool.trim()))) continue;
		const tools = toolsValue?.map(tool => (tool as string).trim());

		const modelValue = frontmatter.model;
		if (modelValue !== undefined && (typeof modelValue !== "string" || !modelValue.trim())) continue;

		let model: string | undefined;
		try {
			model = typeof modelValue === "string" ? resolveModelReference(modelValue.trim()) : undefined;
		} catch {
			continue;
		}

		agents.push({ name: name.trim(), description: description.trim(), tools, model, systemPrompt: body, source, filePath });
	}
	return agents;
}

function isDirectory(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

export function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgentProfiles(cwd: string, scope: AgentScope): AgentProfileDiscoveryResult {
	const userDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);
	const userAgents = scope === "project" ? [] : loadProfilesFromDir(userDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadProfilesFromDir(projectAgentsDir, "project");
	const agents = new Map<string, AgentProfile>();

	for (const agent of userAgents) agents.set(agent.name, agent);
	for (const agent of projectAgents) agents.set(agent.name, agent);
	return { agents: Array.from(agents.values()), projectAgentsDir };
}

/** Returns unique requested profiles that require project-local confirmation. */
export function projectProfilesRequiringConfirmation(agents: readonly AgentProfile[], requestedNames: Iterable<string>): AgentProfile[] {
	return Array.from(new Set(requestedNames))
		.map(name => agents.find(agent => agent.name === name))
		.filter((agent): agent is AgentProfile => agent?.source === "project");
}
