/** Independent Herdr subagent profile discovery. */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { resolveModelReference } from "../shared/model-reference.js";

export type AgentScope = "user" | "project" | "both";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface AgentProfile {
	name: string;
	description: string;
	tools?: string[];
	allowedChildren?: string[];
	model?: string;
	thinking?: ThinkingLevel;
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

		const allowedChildren = parseAllowedChildren(frontmatter.allowedChildren);
		if (frontmatter.allowedChildren !== undefined && !allowedChildren) continue;

		const modelValue = frontmatter.model;
		if (modelValue !== undefined && (typeof modelValue !== "string" || !modelValue.trim())) continue;

		const thinkingValue = frontmatter.thinking;
		if (thinkingValue !== undefined && (typeof thinkingValue !== "string" || !THINKING_LEVELS.has(thinkingValue as ThinkingLevel))) continue;

		let model: string | undefined;
		try {
			model = typeof modelValue === "string" ? resolveModelReference(modelValue.trim()) : undefined;
		} catch {
			continue;
		}

		const thinking = thinkingValue as ThinkingLevel | undefined;
		agents.push({ name: name.trim(), description: description.trim(), tools, ...(allowedChildren ? { allowedChildren } : {}), model, thinking, systemPrompt: body, source, filePath });
	}
	return agents;
}

/** Parse nested-delegation authority identically for frontmatter and child env. */
export function parseAllowedChildren(value: unknown): string[] | undefined {
	if (!Array.isArray(value) || value.length === 0) return undefined;
	const children = value.map(child => typeof child === "string" ? child.trim() : "");
	if (children.some(child => !PROFILE_NAME.test(child)) || new Set(children).size !== children.length) return undefined;
	return children;
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

/** Returns unique selected project profiles, identified by immutable discovery source. */
export function projectProfilesRequiringConfirmation(selectedProfiles: Iterable<AgentProfile>): AgentProfile[] {
	const seen = new Set<string>();
	const projectProfiles: AgentProfile[] = [];
	for (const profile of selectedProfiles) {
		const identity = `${profile.source}\0${canonicalProfilePath(profile.filePath)}`;
		if (profile.source === "project" && !seen.has(identity)) {
			seen.add(identity);
			projectProfiles.push(profile);
		}
	}
	return projectProfiles;
}

function canonicalProfilePath(filePath: string): string {
	try { return fs.realpathSync(filePath); } catch { return path.resolve(filePath); }
}
