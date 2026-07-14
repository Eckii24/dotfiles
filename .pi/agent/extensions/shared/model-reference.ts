import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

function getAgentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR;
	if (configured?.trim()) return resolve(configured);
	if (process.env.HOME?.trim()) return resolve(process.env.HOME, ".pi", "agent");
	return resolve(".pi", "agent");
}

export function loadDefaultProvider(agentDir = getAgentDir()): string {
	const settingsPath = join(agentDir, "settings.json");
	if (!existsSync(settingsPath)) throw new Error(`Cannot resolve bare model ID: settings file not found: ${settingsPath}`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(settingsPath, "utf-8"));
	} catch {
		throw new Error(`Cannot resolve bare model ID: invalid settings JSON: ${settingsPath}`);
	}
	const provider = parsed && typeof parsed === "object" ? (parsed as { defaultProvider?: unknown }).defaultProvider : undefined;
	if (typeof provider !== "string" || !provider.trim() || provider.includes("/")) {
		throw new Error(`Cannot resolve bare model ID: settings defaultProvider is missing or invalid: ${settingsPath}`);
	}
	return provider.trim();
}

export function normalizeModelReference(model: string, defaultProvider: string): string {
	const trimmed = model.trim();
	if (!trimmed) throw new Error("Model reference must not be empty");
	if (trimmed.includes("/")) return trimmed;
	const provider = defaultProvider.trim();
	if (!provider || provider.includes("/")) throw new Error(`Invalid default provider: ${defaultProvider}`);
	return `${provider}/${trimmed}`;
}

export function resolveModelReference(model: string, agentDir?: string): string {
	return normalizeModelReference(model, loadDefaultProvider(agentDir));
}
