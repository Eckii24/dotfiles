import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildMemoryCompactionResult } from "../extensions/memory-system/compaction.js";
import { buildBaseContextPackage, buildTaskContextPackage } from "../extensions/memory-system/context-package.js";
import {
	BASE_PACKAGE_TOKEN_BUDGET,
	TASK_AUGMENTATION_TOKEN_BUDGET,
	estimateTokens,
} from "../extensions/memory-system/contracts.js";
import {
	MAX_ACTIVE_LEARNING_RECORDS,
	applyLearningActions,
	archiveLearningRecords,
	listPromotionEligibleLearnings,
	listStaleLearningRecords,
	loadLearningStore,
	loadPendingLearnings,
	mergePendingRecommendations,
	persistApprovedLearnings,
	upsertPendingLearnings,
	validateLearningRecords,
} from "../extensions/memory-system/learnings.js";
import { buildPendingReviewPrompt, shouldAutoDispatchPendingLearnings, shouldAutoDispatchPendingReview } from "../extensions/memory-system/pending-review.js";
import { resolveMemoryPaths } from "../extensions/memory-system/paths.js";
import {
	applyMemoryProposalActions,
	buildPromotionProposalFromLearning,
	loadPendingMemoryProposals,
} from "../extensions/memory-system/promotions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const phase1Fixtures = join(repoRoot, "scripts", "fixtures", "memory-system", "phase1");
const phase2Fixtures = join(repoRoot, "scripts", "fixtures", "memory-system", "phase2");
const phase3Fixtures = join(repoRoot, "scripts", "fixtures", "memory-system", "phase3");
const phase4Fixtures = join(repoRoot, "scripts", "fixtures", "memory-system", "phase4");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function runCommand(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
	});
}

async function evalPhase1() {
	const agentRoot = join(phase1Fixtures, "agent-root");
	const projectRoot = join(phase1Fixtures, "project-root");
	const sameRoot = join(phase1Fixtures, "same-root");
	const nestedProjectCwd = join(projectRoot, "extensions", "demo");
	const extensionEntry = join(repoRoot, "extensions", "memory-system", "index.ts");

	assert(existsSync(extensionEntry), `Missing extension entry: ${extensionEntry}`);

	const defaultPaths = await resolveMemoryPaths(projectRoot, { agentRoot });
	assert(defaultPaths.sameRoot === false, "Expected default fixture to resolve as non-same-root.");
	assert(
		defaultPaths.learnings.globalPath === join(agentRoot, ".ai", "global-learning.md"),
		"Expected canonical global learning path.",
	);
	assert(
		defaultPaths.learnings.projectPath === join(projectRoot, ".ai", "learning.md"),
		"Expected canonical project learning path.",
	);

	const nestedPaths = await resolveMemoryPaths(nestedProjectCwd, { agentRoot });
	assert(nestedPaths.projectRoot === projectRoot, "Expected nested fixture cwd to resolve back to the fixture project root.");
	assert(nestedPaths.sameRoot === false, "Expected nested fixture cwd to keep non-same-root mapping.");

	const sameRootPaths = await resolveMemoryPaths(sameRoot, { agentRoot: sameRoot, projectRoot: sameRoot });
	assert(sameRootPaths.sameRoot === true, "Expected same-root fixture to resolve as same-root.");
	assert(
		sameRootPaths.learnings.globalPath === join(sameRoot, ".ai", "global-learning.md"),
		"Expected same-root global learnings split path.",
	);
	assert(
		sameRootPaths.learnings.projectPath === join(sameRoot, ".ai", "learning.md"),
		"Expected same-root project learnings split path.",
	);

	const basePackage = await buildBaseContextPackage(defaultPaths);
	assert(basePackage.diagnostics.selected.length >= 2, "Expected base package to select profile/current-work snippets.");
	assert(basePackage.diagnostics.budget.used <= BASE_PACKAGE_TOKEN_BUDGET, "Base package exceeded token budget.");
	assert(basePackage.diagnostics.budget.used === estimateTokens(basePackage.content), "Base package budget should match rendered content.");
	assert(basePackage.content.includes(defaultPaths.userProfilePath), "Base package should include user-profile source path.");
	assert(basePackage.content.includes(defaultPaths.projectProfilePath), "Base package should include project-profile source path.");

	const fallbackBasePackage = await buildBaseContextPackage({
		...defaultPaths,
		userProfilePath: join(agentRoot, ".ai", "missing-user-profile.md"),
		projectProfilePath: join(projectRoot, ".ai", "missing-project-profile.md"),
	});
	assert(
		fallbackBasePackage.diagnostics.selected.some(
			(snippet) => snippet.kind === "conventions" || snippet.kind === "project-memory" || snippet.kind === "pitfalls",
		),
		"Expected missing-profile fallback to pull from durable project memory.",
	);

	const taskPackage = await buildTaskContextPackage(defaultPaths, "Implement phase 1 memory system and run the eval harness.", {
		excludeDedupeKeys: new Set(basePackage.diagnostics.selected.map((snippet) => snippet.dedupeKey)),
	});
	assert(taskPackage.diagnostics.classification === "feature-continuation", "Expected feature-continuation task classification.");
	assert(taskPackage.diagnostics.budget.used <= TASK_AUGMENTATION_TOKEN_BUDGET, "Task package exceeded token budget.");
	assert(taskPackage.diagnostics.budget.used === estimateTokens(taskPackage.content), "Task package budget should match rendered content.");
	assert(taskPackage.diagnostics.selected.every((snippet) => snippet.estimatedTokens > 0), "Expected non-empty task snippets.");
	assert(
		taskPackage.content.includes("Validate workspace facts against live files") ||
			taskPackage.content.includes("Validate workspace facts") ||
			taskPackage.content.includes("Validate against live workspace"),
		"Task package should include validation guidance.",
	);

	for (const cwd of [projectRoot, nestedProjectCwd]) {
		const piRun = await runCommand(
			"pi",
			[
				"-p",
				"--no-session",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"-e",
				extensionEntry,
				"/memory-status implement phase 1 memory system",
			],
			{
				cwd,
				env: {
					PI_OFFLINE: "1",
					PI_MEMORY_SYSTEM_AGENT_ROOT: agentRoot,
				},
			},
		);
		assert(piRun.code === 0, `Expected pi command to succeed. stderr: ${piRun.stderr}`);
		const piOutput = `${piRun.stdout}\n${piRun.stderr}`;
		assert(piOutput.includes("Memory status"), `Expected memory-status output. output: ${piOutput}`);
		assert(piOutput.includes(`Project root: ${projectRoot}`), "Expected memory-status report to resolve the fixture project root.");
		assert(piOutput.includes("Same root: no"), "Expected memory-status report to include same-root state.");
	}

	const sameRootPiRun = await runCommand(
		"pi",
		[
			"-p",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"-e",
			extensionEntry,
			"/memory-status implement phase 1 memory system",
		],
		{
			cwd: sameRoot,
			env: {
				PI_OFFLINE: "1",
				PI_MEMORY_SYSTEM_AGENT_ROOT: sameRoot,
			},
		},
	);
	assert(sameRootPiRun.code === 0, `Expected same-root pi command to succeed. stderr: ${sameRootPiRun.stderr}`);
	const sameRootPiOutput = `${sameRootPiRun.stdout}\n${sameRootPiRun.stderr}`;
	assert(sameRootPiOutput.includes(`Project root: ${sameRoot}`), "Expected same-root CLI run to resolve the same-root fixture.");
	assert(sameRootPiOutput.includes("Same root: yes"), "Expected same-root CLI run to report same-root state.");
	assert(sameRootPiOutput.includes("global-learning.md"), "Expected same-root CLI run to report global split learnings path.");
	assert(sameRootPiOutput.includes("learning.md"), "Expected same-root CLI run to report project split learnings path.");

	console.log("PASS memory-system phase1");
}

async function evalPhase2() {
	const agentRoot = join(phase2Fixtures, "agent-root");
	const projectRoot = join(phase2Fixtures, "project-root");
	const sameRoot = join(phase2Fixtures, "same-root");
	const extensionEntry = join(repoRoot, "extensions", "memory-system", "index.ts");

	const defaultPaths = await resolveMemoryPaths(projectRoot, { agentRoot });
	assert(defaultPaths.sameRoot === false, "Expected phase2 default fixture to resolve as non-same-root.");

	const projectStore = await loadLearningStore(defaultPaths.learnings.projectPath, "project");
	assert(projectStore && projectStore.records.length === 3, "Expected three project learning records in phase2 fixture.");
	const globalStore = await loadLearningStore(defaultPaths.learnings.globalPath, "global");
	assert(globalStore && globalStore.records.length === 1, "Expected one global learning record in phase2 fixture.");
	const pendingState = await loadPendingLearnings(defaultPaths.pendingLearningsPath);
	assert(pendingState && pendingState.recommendations.length === 1, "Expected one pending learning recommendation in phase2 fixture.");
	assert(pendingState.recommendations[0]?.occurrenceDelta === 0, "Scheduled pending recommendations must not increment occurrence counts.");
	assert(
		shouldAutoDispatchPendingLearnings({
			hasUI: true,
			reason: "startup",
			pendingCount: pendingState.recommendations.length,
			availableCommandNames: ["learn", "memory-status"],
		}),
		"Expected startup with UI and pending learnings to auto-dispatch /learn review.",
	);
	assert(
		!shouldAutoDispatchPendingLearnings({
			hasUI: true,
			reason: "reload",
			pendingCount: pendingState.recommendations.length,
			availableCommandNames: ["learn", "memory-status"],
		}),
		"Expected reload to skip auto-dispatch of /learn review.",
	);

	const basePackage = await buildBaseContextPackage(defaultPaths);
	assert(
		basePackage.diagnostics.selected.some((snippet) => snippet.kind === "pending-learnings"),
		"Expected base package to surface pending learnings queue.",
	);

	const taskPackage = await buildTaskContextPackage(
		defaultPaths,
		"Implement phase 2 split learning stores, questionnaire approval flow, and fixture-backed eval coverage.",
		{
			excludeDedupeKeys: new Set(basePackage.diagnostics.selected.map((snippet) => snippet.dedupeKey)),
		},
	);
	const projectLearningIndex = taskPackage.diagnostics.selected.findIndex((snippet) => snippet.kind === "learning-project");
	assert(projectLearningIndex >= 0, "Expected task package to include project-local learnings.");
	assert(
		taskPackage.diagnostics.skipped.some(
			(skipped) => skipped.kind === "learning-global" && skipped.reason.includes("Duplicate of an already selected snippet"),
		),
		"Expected duplicate global guidance to be skipped after project-local dedupe.",
	);
	assert(taskPackage.diagnostics.budget.used <= TASK_AUGMENTATION_TOKEN_BUDGET, "Phase2 task package exceeded token budget.");

	const sameRootPaths = await resolveMemoryPaths(sameRoot, { agentRoot: sameRoot, projectRoot: sameRoot });
	assert(sameRootPaths.sameRoot === true, "Expected phase2 same-root fixture to resolve as same-root.");
	const sameRootTask = await buildTaskContextPackage(
		sameRootPaths,
		"Fix same-root split learning stores and pending queue handling.",
	);
	assert(
		sameRootTask.diagnostics.selected.some(
			(snippet) => snippet.kind === "learning-project" && snippet.sourcePath.endsWith("learning.md"),
		),
		"Expected same-root task package to use learning.md.",
	);

	const mergedPending = mergePendingRecommendations(
		pendingState.recommendations,
		[
			{
				title: pendingState.recommendations[0]!.title,
				category: pendingState.recommendations[0]!.category,
				scopeLabel: pendingState.recommendations[0]!.scopeLabel,
				source: "scheduled-analysis:2026-04-12",
				confidence: "high",
				pattern: pendingState.recommendations[0]!.pattern,
				recommendation: pendingState.recommendations[0]!.recommendation,
				evidence: ["/scripts/scheduled-learn.sh"],
				storeTarget: pendingState.recommendations[0]!.storeTarget,
				occurrenceDelta: 1,
			},
		],
		defaultPaths.pendingLearningsPath,
	);
	assert(mergedPending[0]?.occurrenceDelta === 0, "Scheduled pending merges must preserve occurrence delta 0.");

	const tempDir = await mkdtemp(join(tmpdir(), "memory-system-phase2-"));
	const tempStorePath = join(tempDir, "learning.md");
	const persisted = await persistApprovedLearnings({
		path: tempStorePath,
		target: "project",
		recommendations: [
			{
				title: "Persist approved project learning",
				category: "successful-tactic",
				scopeLabel: "project:temp-fixture",
				source: "manual",
				confidence: "high",
				pattern: "Manual approval confirmed the learning recommendation.",
				recommendation: "Persist the approved learning to the project store.",
				evidence: ["/tmp/manual-approval.md"],
				storeTarget: "project",
				occurrenceDelta: 1,
			},
		],
	});
	assert(persisted.records.length === 1 && persisted.records[0]?.occurrences === 1, "Expected approved learning to persist with one occurrence.");
	const persistedAgain = await persistApprovedLearnings({
		path: tempStorePath,
		target: "project",
		recommendations: [
			{
				title: "Persist approved project learning",
				category: "successful-tactic",
				scopeLabel: "project:temp-fixture",
				source: "manual",
				confidence: "high",
				pattern: "Manual approval confirmed the learning recommendation.",
				recommendation: "Persist the approved learning to the project store.",
				evidence: ["/tmp/manual-approval.md"],
				storeTarget: "project",
				occurrenceDelta: 1,
			},
		],
	});
	assert(persistedAgain.records[0]?.occurrences === 2, "Expected repeated manual approval to increment occurrences.");

	const actionPaths = await resolveMemoryPaths(tempDir, { agentRoot: tempDir, projectRoot: tempDir });
	const actionResult = await applyLearningActions(actionPaths, [
		{
			action: "approve",
			target: "project",
			title: "Approved via shared action path",
			category: "successful-tactic",
			scopeLabel: "project:action-fixture",
			source: "manual",
			confidence: "high",
			pattern: "Interactive approval should reuse a shared persistence path.",
			recommendation: "Persist approved learnings through a single helper used by both /learn and queue review.",
			evidence: ["/tmp/action-approved.md"],
			storeTarget: "project",
			occurrenceDelta: 1,
		},
		{
			action: "queue",
			target: "project",
			title: "Queued via shared action path",
			category: "tool-usage-pattern",
			scopeLabel: "project:action-fixture",
			source: "scheduled-analysis:2026-04-11",
			confidence: "medium",
			pattern: "Scheduled discoveries should be queued, not promoted directly.",
			recommendation: "Queue scheduled discoveries for later review.",
			evidence: ["/tmp/action-queued.md"],
			storeTarget: "project",
			occurrenceDelta: 1,
		},
	]);
	assert(actionResult.approvedProject === 1, "Expected shared action path to approve one project learning.");
	assert(actionResult.queued === 1, "Expected shared action path to queue one learning.");
	assert(actionResult.pendingCount === 1, "Expected shared action path to leave one queued pending learning.");
	assert(actionResult.changedPaths.includes(actionPaths.learnings.projectPath), "Expected shared action path to touch the project learnings store.");
	assert(actionResult.changedPaths.includes(actionPaths.pendingLearningsPath), "Expected shared action path to touch the pending queue.");

	const cappedPaths = await resolveMemoryPaths(join(tempDir, "cap-fixture"), {
		agentRoot: join(tempDir, "cap-fixture"),
		projectRoot: join(tempDir, "cap-fixture"),
	});
	await persistApprovedLearnings({
		path: cappedPaths.learnings.projectPath,
		target: "project",
		recommendations: Array.from({ length: MAX_ACTIVE_LEARNING_RECORDS }, (_, index) => ({
			title: `Capped record ${index + 1}`,
			category: "successful-tactic" as const,
			scopeLabel: "project:cap-fixture",
			source: "manual",
			confidence: "medium" as const,
			pattern: `Pattern ${index + 1}`,
			recommendation: `Recommendation ${index + 1}`,
			evidence: [`/tmp/evidence-${index + 1}.md`],
			storeTarget: "project" as const,
			occurrenceDelta: 1,
		})),
	});
	const cappedActionResult = await applyLearningActions(cappedPaths, [
		{
			action: "approve",
			target: "project",
			title: "Overflow record",
			category: "successful-tactic",
			scopeLabel: "project:cap-fixture",
			source: "manual",
			confidence: "medium",
			pattern: "Overflow pattern",
			recommendation: "Overflow recommendation",
			evidence: ["/tmp/overflow.md"],
			storeTarget: "project",
			occurrenceDelta: 1,
		},
	]);
	assert(cappedActionResult.blockedByCapacity === 1, "Expected applyLearningActions to block overflow approvals when the store is full.");
	assert(cappedActionResult.capacityTargets.includes("project"), "Expected capacity block to report the project target.");
	assert(cappedActionResult.pendingCount === 1, "Expected blocked overflow approval to stay queued in pending learnings.");

	assert(existsSync(join(repoRoot, "agents", "learning-analyst.md")), "Missing agents/learning-analyst.md");
	assert(existsSync(join(repoRoot, "prompts", "learn.md")), "Missing prompts/learn.md");

	const piRun = await runCommand(
		"pi",
		[
			"-p",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"-e",
			extensionEntry,
			"/memory-status implement phase 2 split learning stores and questionnaire approval flow",
		],
		{
			cwd: projectRoot,
			env: {
				PI_OFFLINE: "1",
				PI_MEMORY_SYSTEM_AGENT_ROOT: agentRoot,
			},
		},
	);
	assert(piRun.code === 0, `Expected phase2 pi command to succeed. stderr: ${piRun.stderr}`);
	const piOutput = `${piRun.stdout}\n${piRun.stderr}`;
	assert(piOutput.includes("Pending learnings path:"), "Expected memory-status report to include pending learnings path.");
	assert(piOutput.includes("Learning —"), "Expected memory-status report to include learning snippets.");

	console.log("PASS memory-system phase2");
}

async function evalPhase3() {
	const agentRoot = join(phase3Fixtures, "agent-root");
	const projectRoot = join(phase3Fixtures, "project-root");
	const extensionEntry = join(repoRoot, "extensions", "memory-system", "index.ts");
	const defaultPaths = await resolveMemoryPaths(projectRoot, { agentRoot });

	assert(defaultPaths.pendingMemoryProposalsPath === join(projectRoot, ".ai", "pending-memory-proposals.md"), "Expected pending memory proposals path to resolve inside the project .ai folder.");

	const basePackage = await buildBaseContextPackage(defaultPaths);
	assert(
		basePackage.diagnostics.selected.some((snippet) => snippet.kind === "pending-memory-proposals"),
		"Expected base package to surface queued durable/profile proposals.",
	);

	const projectStore = await loadLearningStore(defaultPaths.learnings.projectPath, "project");
	assert(projectStore && projectStore.records.length === 3, "Expected three project learning records in phase3 fixture.");
	assert(listStaleLearningRecords(projectStore.records).length === 1, "Expected one stale project learning in phase3 fixture.");
	assert(listPromotionEligibleLearnings(projectStore.records).length === 2, "Expected two promotion-eligible project learnings in phase3 fixture.");

	const globalStore = await loadLearningStore(defaultPaths.learnings.globalPath, "global");
	assert(globalStore && globalStore.records.length === 1, "Expected one global learning record in phase3 fixture.");
	assert(listPromotionEligibleLearnings(globalStore.records).length === 1, "Expected one global promotion-eligible learning.");

	const conventionProposal = buildPromotionProposalFromLearning(projectStore.records.find((record) => record.id === "L-20260411-002")!);
	assert(conventionProposal.target === "conventions", "Expected convention discovery to promote into conventions by default.");
	const projectProfileProposal = buildPromotionProposalFromLearning(projectStore.records.find((record) => record.id === "L-20260411-003")!);
	assert(projectProfileProposal.target === "project-profile", "Expected project-scoped user preference to promote into the project profile.");
	const userProfileProposal = buildPromotionProposalFromLearning(globalStore.records[0]!);
	assert(userProfileProposal.target === "user-profile", "Expected global user preference to promote into the user profile.");

	const tempLearnDir = await mkdtemp(join(tmpdir(), "memory-system-phase3-learnings-"));
	const tempLearnPath = join(tempLearnDir, "learning.md");
	await writeFile(tempLearnPath, await readFile(defaultPaths.learnings.projectPath, "utf8"), "utf8");
	const validatedStore = await validateLearningRecords({
		path: tempLearnPath,
		target: "project",
		recordIds: ["L-20260101-001"],
		validatedAt: "2026-04-12",
	});
	assert(validatedStore.records.find((record) => record.id === "L-20260101-001")?.lastValidated === "2026-04-12", "Expected validateLearningRecords to refresh lastValidated.");
	const archivedStore = await archiveLearningRecords({
		path: tempLearnPath,
		target: "project",
		recordIds: ["L-20260101-001"],
		reason: "stale-review",
		durableTarget: "pitfalls",
	});
	assert(archivedStore.records.length === 2, "Expected archiveLearningRecords to remove the archived record from the active set.");
	const archivedRaw = await readFile(tempLearnPath, "utf8");
	assert(archivedRaw.includes("### L-20260101-001 — Archive stale learnings instead of trusting them forever"), "Expected archived stale learning block to be preserved in the file.");
	assert(archivedRaw.includes("Durable target"), "Expected archived learning metadata to mention the durable target.");

	const tempMemoryRoot = await mkdtemp(join(tmpdir(), "memory-system-phase3-promotions-"));
	const tempAgentRoot = join(tempMemoryRoot, "agent-root");
	const tempProjectRoot = join(tempMemoryRoot, "project-root");
	await mkdir(join(tempAgentRoot, ".ai"), { recursive: true });
	await mkdir(join(tempProjectRoot, ".ai"), { recursive: true });
	const proposalPaths = await resolveMemoryPaths(tempProjectRoot, { agentRoot: tempAgentRoot, projectRoot: tempProjectRoot });
	const proposalResult = await applyMemoryProposalActions(proposalPaths, [
		{
			action: "approve",
			target: "conventions",
			title: "Promote durable convention",
			scopeLabel: "project:phase3-temp",
			source: "promotion:L-1",
			content: "Keep durable conventions in canonical `.ai/conventions.md`.",
			evidence: ["/tmp/convention.md"],
			derivedFrom: ["L-1"],
		},
		{
			action: "approve",
			target: "decision",
			title: "Keep compaction output deterministic",
			scopeLabel: "project:phase3-temp",
			source: "promotion:L-2",
			content: "Use deterministic compaction summaries in the eval harness instead of a live model call.",
			evidence: ["/tmp/decision.md"],
			derivedFrom: ["L-2"],
		},
		{
			action: "approve",
			target: "project-profile",
			title: "Revise project profile highlights",
			scopeLabel: "project:phase3-temp",
			source: "promotion:L-3",
			content: "Revise project profile highlights in place and keep them concise.",
			section: "High-Signal Conventions",
			evidence: ["/tmp/project-profile.md"],
			derivedFrom: ["L-3"],
		},
		{
			action: "approve",
			target: "user-profile",
			title: "Preserve approval gating for durable writes",
			scopeLabel: "global",
			source: "promotion:L-4",
			content: "Require explicit approval before persisting durable memory or profile updates.",
			section: "Stable Preferences",
			evidence: ["/tmp/user-profile.md"],
			derivedFrom: ["L-4"],
		},
		{
			action: "queue",
			target: "pitfalls",
			title: "Queue recurring pitfall review",
			scopeLabel: "project:phase3-temp",
			source: "promotion:L-5",
			content: "Archive stale learnings instead of trusting them forever.",
			evidence: ["/tmp/pitfall.md"],
			derivedFrom: ["L-5"],
		},
	]);
	assert(proposalResult.approved === 4, "Expected four approved durable/profile proposals.");
	assert(proposalResult.queued === 1, "Expected one queued durable/profile proposal.");
	assert(proposalResult.pendingCount === 1, "Expected one pending durable/profile proposal after queueing.");
	assert(existsSync(proposalPaths.projectMemoryPaths.conventions), "Expected conventions.md to be created for approved durable conventions.");
	assert(existsSync(proposalPaths.projectProfilePath), "Expected project-profile.md to be created or updated.");
	assert(existsSync(proposalPaths.userProfilePath), "Expected user-profile.md to be created or updated.");
	assert(proposalResult.changedPaths.some((path) => path.endsWith("keep-compaction-output-deterministic.md")), "Expected an ADR-style decision file to be created.");
	const pendingMemoryState = await loadPendingMemoryProposals(proposalPaths.pendingMemoryProposalsPath);
	assert(pendingMemoryState && pendingMemoryState.proposals.length === 1, "Expected queued durable/profile proposal to persist in pending-memory-proposals.md.");
	const projectProfileRaw = await readFile(proposalPaths.projectProfilePath, "utf8");
	assert(projectProfileRaw.includes("Revise project profile highlights in place and keep them concise."), "Expected approved project-profile proposal to update the profile summary.");
	const userProfileRaw = await readFile(proposalPaths.userProfilePath, "utf8");
	assert(userProfileRaw.includes("Require explicit approval before persisting durable memory or profile updates."), "Expected approved user-profile proposal to update the global profile.");

	const refreshedPendingRoot = await mkdtemp(join(tmpdir(), "memory-system-phase3-refresh-"));
	const refreshedPaths = await resolveMemoryPaths(refreshedPendingRoot, { agentRoot: refreshedPendingRoot, projectRoot: refreshedPendingRoot });
	await upsertPendingLearnings(refreshedPaths.pendingLearningsPath, [
		{
			title: "Refresh base package after pending review",
			category: "successful-tactic",
			scopeLabel: "project:refresh-fixture",
			source: "manual",
			confidence: "high",
			pattern: "Base package should be rebuilt after pending learnings are reviewed.",
			recommendation: "Refresh the base package after /learn review removes or approves pending learnings.",
			evidence: ["/tmp/refresh.md"],
			storeTarget: "project",
			occurrenceDelta: 1,
		},
	]);
	const baseBeforeRefresh = await buildBaseContextPackage(refreshedPaths);
	assert(baseBeforeRefresh.diagnostics.selected.some((snippet) => snippet.kind === "pending-learnings"), "Expected pending learnings to appear before review refresh.");
	await applyLearningActions(refreshedPaths, [
		{
			action: "approve",
			target: "project",
			title: "Refresh base package after pending review",
			category: "successful-tactic",
			scopeLabel: "project:refresh-fixture",
			source: "manual",
			confidence: "high",
			pattern: "Base package should be rebuilt after pending learnings are reviewed.",
			recommendation: "Refresh the base package after /learn review removes or approves pending learnings.",
			evidence: ["/tmp/refresh.md"],
			storeTarget: "project",
			occurrenceDelta: 1,
		},
	]);
	const baseAfterRefresh = await buildBaseContextPackage(refreshedPaths);
	assert(!baseAfterRefresh.diagnostics.selected.some((snippet) => snippet.kind === "pending-learnings"), "Expected base package refresh to drop cleared pending learnings.");

	const compactionResult = await buildMemoryCompactionResult({
		paths: defaultPaths,
		preparation: {
			firstKeptEntryId: "entry-123",
			tokensBefore: 4321,
			fileOps: {
				read: new Set(["extensions/memory-system/context-package.ts"]),
				written: new Set(["scripts/eval-memory-system.ts"]),
				edited: new Set(["extensions/memory-system/promotions.ts"]),
			},
		},
		prompt: "Continue phase 3 compaction and promotion hardening.",
	});
	assert(compactionResult.details.activeSlug === "fixture-memory-phase3", "Expected compaction state to preserve the active feature slug.");
	assert(compactionResult.details.preservedHints.length >= 3, "Expected compaction state to preserve multiple memory hints.");
	assert(compactionResult.summary.includes("Run the phase 3 eval harness"), "Expected compaction summary to preserve the next restart step.");
	assert(compactionResult.summary.includes("<modified-files>"), "Expected compaction summary to carry modified-files tags.");
	const compactionTask = await buildTaskContextPackage(defaultPaths, "Continue phase 3 compaction and promotion hardening.", {
		preservedCompactionState: compactionResult.details,
	});
	assert(compactionTask.diagnostics.selected.some((snippet) => snippet.kind === "rehydrated-compaction"), "Expected task context to surface a rehydrated compaction hint.");
	assert(compactionTask.content.includes("Compaction state preserves restart hints"), "Expected rehydrated compaction snippet to carry validation guidance.");

	const piRun = await runCommand(
		"pi",
		[
			"-p",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"-e",
			extensionEntry,
			"/memory-status continue phase 3 compaction and promotion hardening",
		],
		{
			cwd: projectRoot,
			env: {
				PI_OFFLINE: "1",
				PI_MEMORY_SYSTEM_AGENT_ROOT: agentRoot,
			},
		},
	);
	assert(piRun.code === 0, `Expected phase3 pi command to succeed. stderr: ${piRun.stderr}`);
	const piOutput = `${piRun.stdout}\n${piRun.stderr}`;
	assert(piOutput.includes("Pending memory proposals path:"), "Expected memory-status report to include the pending memory proposals path.");

	console.log("PASS memory-system phase3");
}

async function evalPhase4() {
	const agentRoot = join(phase4Fixtures, "agent-root");
	const projectRoot = join(phase4Fixtures, "project-root");
	const extensionEntry = join(repoRoot, "extensions", "memory-system", "index.ts");
	const defaultPaths = await resolveMemoryPaths(projectRoot, { agentRoot });

	const referenceTask = await buildTaskContextPackage(
		defaultPaths,
		"Summarize the reference docs about memory research and Pi extension compaction hooks.",
	);
	assert(referenceTask.diagnostics.selected.some((snippet) => snippet.kind === "reference-note"), "Expected task package to surface reference note snippets for reference-style prompts.");
	assert(
		referenceTask.content.includes("memory-system-research.md") || referenceTask.content.includes("pi-extension-hooks.md"),
		"Expected reference task package to include at least one fixture reference path.",
	);

	assert(
		shouldAutoDispatchPendingReview({
			hasUI: true,
			reason: "startup",
			pendingLearningCount: 1,
			pendingMemoryProposalCount: 1,
			availableCommandNames: ["learn", "memory-status"],
		}),
		"Expected unified pending review dispatch to trigger when either queue has entries.",
	);
	assert(
		buildPendingReviewPrompt([defaultPaths.pendingLearningsPath, defaultPaths.pendingMemoryProposalsPath]) ===
			`/learn review ${defaultPaths.pendingLearningsPath} ${defaultPaths.pendingMemoryProposalsPath}`,
		"Expected pending review prompt to include both queue paths.",
	);

	const mutableRoot = await mkdtemp(join(tmpdir(), "memory-system-phase4-mutable-"));
	const mutableAgentRoot = join(mutableRoot, "agent-root");
	const mutableProjectRoot = join(mutableRoot, "project-root");
	await mkdir(join(mutableAgentRoot, ".ai"), { recursive: true });
	await mkdir(join(mutableProjectRoot, ".ai", "references"), { recursive: true });
	for (const [from, to] of [
		[join(agentRoot, ".ai", "user-profile.md"), join(mutableAgentRoot, ".ai", "user-profile.md")],
		[join(projectRoot, ".ai", "current-work.md"), join(mutableProjectRoot, ".ai", "current-work.md")],
		[join(projectRoot, ".ai", "project-profile.md"), join(mutableProjectRoot, ".ai", "project-profile.md")],
		[join(projectRoot, ".ai", "pending-learnings.md"), join(mutableProjectRoot, ".ai", "pending-learnings.md")],
		[join(projectRoot, ".ai", "pending-memory-proposals.md"), join(mutableProjectRoot, ".ai", "pending-memory-proposals.md")],
		[join(projectRoot, ".ai", "references", "index.md"), join(mutableProjectRoot, ".ai", "references", "index.md")],
		[join(projectRoot, ".ai", "references", "memory-system-research.md"), join(mutableProjectRoot, ".ai", "references", "memory-system-research.md")],
		[join(projectRoot, ".ai", "references", "pi-extension-hooks.md"), join(mutableProjectRoot, ".ai", "references", "pi-extension-hooks.md")],
	] as const) {
		await writeFile(to, await readFile(from, "utf8"), "utf8");
	}
	const mutablePaths = await resolveMemoryPaths(mutableProjectRoot, { agentRoot: mutableAgentRoot, projectRoot: mutableProjectRoot });

	const baseWithPending = await buildBaseContextPackage(mutablePaths);
	assert(baseWithPending.diagnostics.selected.some((snippet) => snippet.kind === "pending-memory-proposals"), "Expected base package to surface pending durable/profile proposals before review.");
	await applyMemoryProposalActions(mutablePaths, [
		{
			action: "reject",
			target: "project-profile",
			title: "Queue project profile refresh",
			scopeLabel: "project:phase3-fixture",
			source: "promotion:L-20260411-003",
			content: "Keep project profile updates concise and revise them in place instead of appending endlessly.",
			section: "High-Signal Conventions",
			evidence: ["/.ai/project-profile.md", "/extensions/memory-system/promotions.ts"],
			derivedFrom: ["L-20260411-003"],
		},
	]);
	const baseAfterPendingReview = await buildBaseContextPackage(mutablePaths);
	assert(!baseAfterPendingReview.diagnostics.selected.some((snippet) => snippet.kind === "pending-memory-proposals"), "Expected base package refresh to drop cleared durable/profile proposals after review.");

	const dryRun = await runCommand(
		"bash",
		[
			"scripts/scheduled-learn.sh",
			"--dry-run",
			"--project-root",
			mutableProjectRoot,
			"--agent-root",
			mutableAgentRoot,
		],
		{ cwd: repoRoot },
	);
	assert(dryRun.code === 0, `Expected scheduled-learn dry-run to succeed. stderr: ${dryRun.stderr}`);
	const dryRunOutput = `${dryRun.stdout}\n${dryRun.stderr}`;
	assert(dryRunOutput.includes("scheduled-analysis:"), "Expected scheduled-learn dry-run to report a scheduled-analysis source.");
	assert(dryRunOutput.includes('"occurrenceDelta": 0'), "Expected scheduled-learn dry-run to report occurrenceDelta 0.");

	const scheduledRun = await runCommand(
		"bash",
		[
			"scripts/scheduled-learn.sh",
			"--project-root",
			mutableProjectRoot,
			"--agent-root",
			mutableAgentRoot,
		],
		{ cwd: repoRoot },
	);
	assert(scheduledRun.code === 0, `Expected scheduled-learn write run to succeed. stderr: ${scheduledRun.stderr}`);
	const scheduledPendingRaw = await readFile(mutablePaths.pendingLearningsPath, "utf8");
	assert(scheduledPendingRaw.includes("scheduled-analysis:"), "Expected scheduled-learn to write a scheduled-analysis source into pending-learnings.md.");
	assert(scheduledPendingRaw.includes("Occurrence delta**: 0"), "Expected scheduled-learn output to keep occurrence delta at 0.");

	const piRun = await runCommand(
		"pi",
		[
			"-p",
			"--no-session",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"-e",
			extensionEntry,
			"/memory-status summarize the reference docs for compaction hooks",
		],
		{
			cwd: projectRoot,
			env: {
				PI_OFFLINE: "1",
				PI_MEMORY_SYSTEM_AGENT_ROOT: agentRoot,
			},
		},
	);
	assert(piRun.code === 0, `Expected phase4 pi command to succeed. stderr: ${piRun.stderr}`);
	const piOutput = `${piRun.stdout}\n${piRun.stderr}`;
	assert(piOutput.includes("References index path:"), "Expected memory-status report to include the references index path.");

	console.log("PASS memory-system phase4");
}

async function main() {
	const phase = process.argv[2];
	switch (phase) {
		case "phase1":
			await evalPhase1();
			return;
		case "phase2":
			await evalPhase2();
			return;
		case "phase3":
			await evalPhase3();
			return;
		case "phase4":
			await evalPhase4();
			return;
		default:
			console.error("Usage: bun scripts/eval-memory-system.ts phase1|phase2|phase3|phase4");
			process.exit(1);
	}
}

await main();
