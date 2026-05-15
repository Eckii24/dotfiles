import { createHash } from "node:crypto";

export interface ConfiguredSource {
	path: string;
	scope: "global" | "project";
}

export interface ResolvedSource {
	configuredPath: string;
	resolvedPath: string;
	label: string;
	templatePath: string;
}

export interface FrontmatterEntry {
	path: string;
	sourceRelativePath: string;
	displayPath: string;
	description: string;
}

export interface SourceSection {
	configuredPath: string;
	resolvedPath: string;
	label: string;
	content: string;
	entries: FrontmatterEntry[];
}

export interface FrontmatterInjection {
	header: string;
	content: string;
	hash: string;
	totalRefs: number;
	sections: SourceSection[];
}

export interface FrontmatterRuntimeState {
	sessionRoot: string;
	configuredSources: ConfiguredSource[];
	sections: SourceSection[];
	warnings: string[];
	injection?: FrontmatterInjection;
}

export function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 12);
}
