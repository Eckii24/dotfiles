import type { LearningInjection, ScanSummary } from "./contracts.js";
import { hashText } from "./contracts.js";

export function buildLearningInjection(scan: ScanSummary): LearningInjection {
	const lines = [
		`Memory · learnings · ${scan.total} ref${scan.total === 1 ? "" : "s"}`,
		"Treat learning refs as hints; validate live workspace facts before relying on them.",
	];

	if (scan.project.length > 0) {
		lines.push("Project (.ai/learnings):");
		for (const learning of scan.project) {
			lines.push(`- ${learning.filename} — ${learning.frontmatter.summary}`);
		}
	}

	if (scan.global.length > 0) {
		lines.push("Global (~/.agents/learnings):");
		for (const learning of scan.global) {
			lines.push(`- ${learning.filename} — ${learning.frontmatter.summary}`);
		}
	}

	const content = lines.join("\n");
	return {
		header: lines[0],
		content,
		hash: hashText(content),
		totalRefs: scan.total,
	};
}
