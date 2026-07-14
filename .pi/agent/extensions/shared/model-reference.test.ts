import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadDefaultProvider, normalizeModelReference } from "./model-reference.js";

function makeTempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-model-reference-test-"));
}

describe("normalizeModelReference", () => {
	it("uses the configured default provider for a bare model ID", () => {
		expect(normalizeModelReference("gpt-5.6-luna", "openai-codex")).toBe("openai-codex/gpt-5.6-luna");
	});

	it("preserves an explicit provider/model reference", () => {
		expect(normalizeModelReference("github-copilot/gpt-5.6-luna", "openai-codex")).toBe("github-copilot/gpt-5.6-luna");
	});

	it("loads defaultProvider from the active settings file", () => {
		const root = makeTempDir();
		writeFileSync(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex" }));
		expect(loadDefaultProvider(root)).toBe("openai-codex");
		rmSync(root, { recursive: true, force: true });
	});
});
