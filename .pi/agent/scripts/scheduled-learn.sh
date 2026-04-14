#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
PROJECT_ROOT=""
AGENT_ROOT=""

while [[ $# -gt 0 ]]; do
	case "$1" in
		--dry-run)
			DRY_RUN=1
			shift
			;;
		--project|--project-root)
			PROJECT_ROOT="${2:-}"
			shift 2
			;;
		--agent-root)
			AGENT_ROOT="${2:-}"
			shift 2
			;;
		*)
			echo "Unknown argument: $1" >&2
			exit 1
			;;
	esac
done

PROJECT_ROOT="${PROJECT_ROOT:-$PWD}"
AGENT_ROOT="${AGENT_ROOT:-${PI_MEMORY_SYSTEM_AGENT_ROOT:-$PROJECT_ROOT}}"

export PI_SCHEDULED_PROJECT_ROOT="$PROJECT_ROOT"
export PI_SCHEDULED_AGENT_ROOT="$AGENT_ROOT"
export PI_SCHEDULED_DRY_RUN="$DRY_RUN"

bun -e '
import { resolveMemoryPaths } from "./extensions/memory-system/paths.ts";
import { upsertPendingLearnings } from "./extensions/memory-system/learnings.ts";
import { loadWorkingMemorySummary } from "./extensions/memory-system/working-memory.ts";

const projectRoot = process.env.PI_SCHEDULED_PROJECT_ROOT;
const agentRoot = process.env.PI_SCHEDULED_AGENT_ROOT;
const dryRun = process.env.PI_SCHEDULED_DRY_RUN === "1";
if (!projectRoot || !agentRoot) throw new Error("Missing scheduled-learn roots");

const paths = await resolveMemoryPaths(projectRoot, { agentRoot, projectRoot });
const working = await loadWorkingMemorySummary({
	kind: "current-work",
	scope: "feature",
	sourcePath: paths.currentWorkPath,
	exists: false,
});
const stamp = new Date().toISOString().slice(0, 10);
const recommendation = {
	title: working?.slug ? `Scheduled follow-up for ${working.slug}` : "Scheduled follow-up for active memory work",
	category: "successful-tactic" as const,
	scopeLabel: `project:${paths.projectRoot.split("/").filter(Boolean).pop() ?? "workspace"}`,
	source: `scheduled-analysis:${stamp}`,
	confidence: "medium" as const,
	pattern: working?.objective ?? "Scheduled analysis detected active tracked work that may need later interactive review.",
	recommendation: working?.nextRestartStep ?? "Review the active memory work in an interactive session before promoting any learnings.",
	evidence: [paths.currentWorkPath],
	storeTarget: "project" as const,
	occurrenceDelta: 0,
};

if (dryRun) {
	console.log("OK scheduled-learn dry-run");
	console.log(JSON.stringify({
		dryRun: true,
		pendingPath: paths.pendingLearningsPath,
		recommendation: {
			...recommendation,
			occurrenceDelta: 0,
		},
	}, null, 2));
	process.exit(0);
}

const result = await upsertPendingLearnings(paths.pendingLearningsPath, [recommendation]);
console.log("OK scheduled-learn");
console.log(JSON.stringify({
	dryRun: false,
	pendingPath: paths.pendingLearningsPath,
	pendingCount: result.recommendations.length,
	source: recommendation.source,
	occurrenceDelta: 0,
}, null, 2));
' 
