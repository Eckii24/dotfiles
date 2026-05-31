import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ConfiguredSource } from "./contracts.js";

function loadJsonObject(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(path, "utf8"));
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
		return raw as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function parsePaths(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const candidate = (value as { paths?: unknown }).paths;
	if (!Array.isArray(candidate)) return [];
	return candidate.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

export function loadFrontmatterInjectorSources(sessionRoot: string): ConfiguredSource[] {
	const globalSettings = loadJsonObject(join(getAgentDir(), "settings.json"));
	const projectSettings = loadJsonObject(join(sessionRoot, ".pi", "settings.json"));
	const globalPaths = parsePaths(globalSettings?.frontmatterInjector);
	const projectPaths = parsePaths(projectSettings?.frontmatterInjector);
	return [
		...globalPaths.map((path) => ({ path, scope: "global" as const })),
		...projectPaths.map((path) => ({ path, scope: "project" as const })),
	];
}
