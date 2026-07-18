import { expect, test } from "bun:test";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	discoverAgentProfiles,
	findNearestProjectAgentsDir,
	projectProfilesRequiringConfirmation,
} from "./agent-profiles.js";

const fixtures = join(import.meta.dir, "test-fixtures", "agents");

function setup(): { root: string; agentDir: string; projectAgents: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-herdr-profiles-"));
	const agentDir = join(root, "agent");
	const projectAgents = join(root, "workspace", ".pi", "agents");
	cpSync(join(fixtures, "user"), join(agentDir, "agents"), { recursive: true });
	cpSync(join(fixtures, "project"), projectAgents, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
		defaultProvider: "openai-codex",
		modelTiers: { fast: "tier-model", small: "small-model", medium: "medium-model", large: "large-model" },
	}));
	const cwd = join(root, "workspace", "nested", "deeper");
	mkdirSync(cwd, { recursive: true });
	return { root, agentDir, projectAgents, cwd };
}

function withAgentDir<T>(agentDir: string, run: () => T): T {
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	try {
		return run();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	}
}

function profile(agent: { name: string; description: string; tools?: string[]; model?: string; systemPrompt: string; source: string; filePath: string }) {
	return {
		name: agent.name, description: agent.description, ...(agent.tools === undefined ? {} : { tools: agent.tools }),
		...(agent.model === undefined ? {} : { model: agent.model }), systemPrompt: agent.systemPrompt,
		source: agent.source, filePath: agent.filePath.slice(agent.filePath.lastIndexOf("/agents/") + 1),
	};
}

test("golden parity preserves user, project, and both discovery semantics", () => {
	const { root, agentDir, projectAgents, cwd } = setup();
	try {
		withAgentDir(agentDir, () => {
			const user = discoverAgentProfiles(cwd, "user");
			expect(user.projectAgentsDir).toBe(projectAgents);
			expect(user.agents.map(profile).sort((left, right) => left.name.localeCompare(right.name))).toEqual([
				{ name: "bare", description: "Bare model profile", model: "openai-codex/luna", systemPrompt: "Bare model body.", source: "user", filePath: "agents/bare.md" },
				{ name: "base", description: "User base profile", tools: ["read", "bash"], model: "openai-codex/tier-model", systemPrompt: "User body keeps trailing newline.", source: "user", filePath: "agents/base.md" },
				{ name: "explicit", description: "Explicit model profile", model: "github-copilot/claude-haiku-4.5", systemPrompt: "Explicit model body.", source: "user", filePath: "agents/explicit.md" },
				{ name: "no-model", description: "No model profile", systemPrompt: "No model body.", source: "user", filePath: "agents/no-model.md" },
			]);

			const project = discoverAgentProfiles(cwd, "project");
			expect(project.agents.map(profile).sort((left, right) => left.name.localeCompare(right.name))).toEqual([
				{ name: "base", description: "Project override profile", tools: ["read"], model: "openai-codex/project-model", systemPrompt: "Project override body.", source: "project", filePath: "agents/base.md" },
				{ name: "project-only", description: "Project-only profile", tools: ["write", "edit"], systemPrompt: "Project body.", source: "project", filePath: "agents/project-only.md" },
			]);

			const both = discoverAgentProfiles(cwd, "both");
			expect(both.agents.map(agent => agent.name).sort()).toEqual(["bare", "base", "explicit", "no-model", "project-only"]);
			expect(both.agents.find(agent => agent.name === "base")).toMatchObject({ source: "project", description: "Project override profile" });
			expect(projectProfilesRequiringConfirmation(both.agents, ["bare", "base", "base", "missing", "project-only"])
				.map(agent => agent.name)).toEqual(["base", "project-only"]);
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("orchestrator profile parses with exact nested tools and large model", () => {
	const { root, agentDir, cwd } = setup();
	try {
		for (const name of ["orchestrator", "worker", "scout"]) cpSync(join(import.meta.dir, "..", "..", "agents", `${name}.md`), join(agentDir, "agents", `${name}.md`));
		withAgentDir(agentDir, () => {
			const agents = discoverAgentProfiles(cwd, "user").agents;
			const agent = agents.find(value => value.name === "orchestrator");
			expect(agent).toMatchObject({
				name: "orchestrator",
				tools: ["subagent", "subagent_control"],
				model: "openai-codex/large-model",
			});
			for (const name of ["worker", "scout"]) expect(agents.find(value => value.name === name)?.tools).not.toContain("subagent");
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("uses nearest project agents directory and preserves Markdown symlink paths", () => {
	const { root, agentDir, cwd } = setup();
	try {
		const outerAgents = join(root, ".pi", "agents");
		mkdirSync(outerAgents, { recursive: true });
		writeFileSync(join(outerAgents, "outer.md"), "---\nname: outer\ndescription: Outer profile\n---\nOuter.\n");
		expect(findNearestProjectAgentsDir(cwd)).toBe(join(root, "workspace", ".pi", "agents"));

		const isolated = join(root, "isolated");
		mkdirSync(join(isolated, "agents"), { recursive: true });
		const target = join(root, "linked-source.md");
		writeFileSync(target, "---\nname: linked\ndescription: Linked profile\n---\nLinked body.\n");
		const link = join(isolated, "agents", "linked.md");
		symlinkSync(target, link);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
		withAgentDir(isolated, () => {
			const found = discoverAgentProfiles(cwd, "user").agents;
			expect(found).toHaveLength(1);
			expect(found[0]).toMatchObject({ name: "linked", source: "user", filePath: link, systemPrompt: "Linked body." });
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
