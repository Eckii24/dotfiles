import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

type Settings = {
	defaultProvider?: unknown;
	modelTiers?: unknown;
};

const TIER_ALIAS_PATTERN = /^@([A-Za-z][A-Za-z0-9_-]*)$/;

function getAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;
	if (configured?.trim()) return resolve(configured);
	if (process.env.HOME?.trim()) return resolve(process.env.HOME, ".pi", "agent");
	return resolve(".pi", "agent");
}

function loadSettings(agentDir: string): { settingsPath: string; settings: Settings } {
	const settingsPath = join(agentDir, "settings.json");
	if (!existsSync(settingsPath)) throw new Error(`Cannot resolve model reference: settings file not found: ${settingsPath}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		throw new Error(`Cannot resolve model reference: invalid settings JSON: ${settingsPath}`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Cannot resolve model reference: settings must be a JSON object: ${settingsPath}`);
	}
	return { settingsPath, settings: parsed as Settings };
}

function getDefaultProvider(settings: Settings, settingsPath: string): string {
	const provider = settings.defaultProvider;
	if (typeof provider !== "string" || !provider.trim() || provider.includes("/")) {
		throw new Error(`Cannot resolve bare model ID: settings defaultProvider is missing or invalid: ${settingsPath}`);
	}
	return provider.trim();
}

function resolveTierAlias(model: string, settings: Settings, settingsPath: string): string {
	const trimmed = model.trim();
	if (!trimmed.startsWith("@")) return trimmed;
	const match = TIER_ALIAS_PATTERN.exec(trimmed);
	if (!match) throw new Error(`Invalid model-tier alias: ${trimmed}`);
	const tiers = settings.modelTiers;
	if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) {
		throw new Error(`Cannot resolve model-tier alias ${trimmed}: settings modelTiers is missing or invalid: ${settingsPath}`);
	}
	const configured = (tiers as Record<string, unknown>)[match[1]!];
	if (typeof configured !== "string" || !configured.trim()) {
		throw new Error(`Cannot resolve model-tier alias ${trimmed}: no matching modelTiers identifier in ${settingsPath}`);
	}
	const resolved = configured.trim();
	if (resolved.startsWith("@")) {
		throw new Error(`Cannot resolve model-tier alias ${trimmed}: modelTiers values must be concrete model references, not aliases`);
	}
	return resolved;
}

export function loadDefaultProvider(agentDir = getAgentDir()): string {
	const { settingsPath, settings } = loadSettings(agentDir);
	return getDefaultProvider(settings, settingsPath);
}

export function normalizeModelReference(model: string, defaultProvider: string): string {
	const trimmed = model.trim();
	if (!trimmed) throw new Error("Model reference must not be empty");
	if (trimmed.includes("/")) return trimmed;
	const provider = defaultProvider.trim();
	if (!provider || provider.includes("/")) throw new Error(`Invalid default provider: ${defaultProvider}`);
	return `${provider}/${trimmed}`;
}

export function resolveModelReference(model: string, agentDir = getAgentDir()): string {
	const { settingsPath, settings } = loadSettings(agentDir);
	const resolved = resolveTierAlias(model, settings, settingsPath);
	return normalizeModelReference(resolved, getDefaultProvider(settings, settingsPath));
}
