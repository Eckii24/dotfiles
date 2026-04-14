# Memory System for Pi Agent Harness

- **Slug**: self-learning-loop-agent-harness
- **Status**: Done
- **Started**: 2026-04-11
- **Updated**: 2026-04-12

## Objective

Research how a cohesive memory system should be designed for this Pi agent harness, then define an implementation-ready specification that integrates with the existing `.ai/` workflow, Pi extension hooks, and approval-driven memory conventions.

The feature was initially framed as a self-learning loop. Based on additional research and the user’s feedback that the current memory setup feels incomplete, the scope has been broadened: the self-learning loop is now treated as one subsystem inside a larger memory architecture.

## Decisions & rationale

- Evolve the existing self-learning-loop work into a broader memory-system architecture instead of creating a parallel spec — this directly addresses the user’s concern that the current memory setup feels "unrund".
- Keep V1 Markdown-first and file-native — this matches the current repo conventions, existing guardrails, and `project-memory` workflow better than introducing a DB-backed memory system now.
- Preserve the earlier learning-loop requirements as a dedicated memory layer instead of discarding them — they remain valuable, but they are not sufficient on their own.
- Add a profile layer and a reference layer — research consistently showed that compact always-available context plus pull-based source retrieval are both needed.
- Keep V1 repo-local and file-based even when external memory systems are considered — OB1/Open Brain is useful as inspiration and as a possible later optional adapter, but not as a native V1 dependency or source of truth.
- Keep the learning store naming simple and canonical: use `.ai/global-learning.md` for the global store and `.ai/learning.md` for the project store.
- Keep memory-system ranking/parsing logic in pure helper modules under `extensions/memory-system/` so the same code can power both extension hooks and the fixture-backed eval harness.
- Reuse one shared persistence path for manual `/learn` approvals and pending-queue review by routing both through `memory_apply_learning_actions` + `extensions/memory-system/learnings.ts` helpers.
- Use scope-aware keys for store persistence, but scope-agnostic keys for task-time learning retrieval dedupe so project-local guidance wins over equivalent global guidance.
- Profiles should summarize durable context and preferences, but should not duplicate standing agent instructions already guaranteed by `AGENTS.md`, loaded skills, or the system/developer prompt.

## Current state

Phase 1, Phase 2, Phase 3, and Phase 4 are now implemented.

Completed Phase 1 deliverables:
- Added `extensions/memory-system/` with `index.ts`, `contracts.ts`, `markdown.ts`, `paths.ts`, `profiles.ts`, `working-memory.ts`, and `context-package.ts`.
- Implemented same-root path resolution so this repo maps learnings to `.ai/global-learning.md` and `.ai/learning.md`.
- Added session-start base package assembly plus task-start augmentation with explicit source paths, token budgeting, dedupe, task classification, and validation warnings.
- Added `/memory-status` for operator/debug visibility into selected sources, skipped sources, token usage, and learnings path mapping.
- Added `scripts/eval-memory-system.ts` plus `scripts/fixtures/memory-system/phase1/` fixtures.
- Seeded `.ai/user-profile.md` and `.ai/project-profile.md` with source-backed profile summaries.

Completed Phase 2 deliverables:
- Added `extensions/memory-system/learnings.ts` plus `extensions/memory-system/pending-review.ts` for learning-store parsing, ranking, queue handling, shared approval persistence, and session-start pending-review dispatch rules.
- Extended `extensions/memory-system/index.ts` and `context-package.ts` to surface pending learnings, merge dual learning stores, prefer project-local guidance, and auto-dispatch `/learn review ...` when pending learnings exist in an interactive session.
- Added the `memory_apply_learning_actions` tool so approved `/learn` actions and pending-queue review use the same file-native persistence path.
- Created `agents/learning-analyst.md`, `prompts/learn.md`, `.ai/global-learning.md`, `.ai/learning.md`, and `.ai/pending-learnings.md`.
- Updated `prompts/implement-review.md` and `prompts/spec-plan-implement-review.md` to surface `/learn` as an optional post-review step.
- Added `scripts/fixtures/memory-system/phase2/` plus Phase 2 eval coverage for split stores, pending queue handling, dedupe, shared persistence, capacity handling, and session-start dispatch gating.

Completed Phase 3 deliverables:
- Added `extensions/memory-system/promotions.ts` for promotion classification, pending durable/profile proposal storage, and approval-gated durable/profile persistence helpers.
- Added `extensions/memory-system/compaction.ts` plus `session_before_compact` wiring in `extensions/memory-system/index.ts` so compaction preserves restart state, changed files, and source-linked memory hints.
- Extended `extensions/memory-system/contracts.ts`, `context-package.ts`, `paths.ts`, and `working-memory.ts` with pending durable proposal paths, rehydrated compaction hints, richer working-memory extraction, and task/base-package support for preserved compaction state.
- Extended `extensions/memory-system/learnings.ts` with stale/promotion-eligibility helpers plus archival/validation bookkeeping for stale or promoted records.
- Updated `prompts/learn.md` so approved durable/profile changes persist through `memory_apply_memory_proposals` and deferred ones stay queued in `.ai/pending-memory-proposals.md`.
- Added `scripts/fixtures/memory-system/phase3/` plus Phase 3 eval coverage for stale detection, learning archival, durable/profile proposal writes, pending durable proposal queues, compaction payloads, rehydration, and the refreshed base-package path after pending review.

Completed Phase 4 deliverables:
- Added `extensions/memory-system/references.ts` plus `.ai/references/index.md`, `.ai/references/memory-system-research.md`, and `.ai/references/pi-extension-hooks.md` so task-time retrieval can pull supporting reference notes without replacing canonical memory files.
- Extended `extensions/memory-system/context-package.ts`, `pending-review.ts`, and `index.ts` so reference snippets participate in task augmentation and session-start pending review can cover both `.ai/pending-learnings.md` and `.ai/pending-memory-proposals.md`.
- Added `scripts/scheduled-learn.sh` as the scheduled/headless queue writer with `--dry-run`, `--project`/`--project-root`, explicit dry-run banners, and zero-occurrence scheduled recommendations.
- Added `scripts/fixtures/memory-system/phase4/` plus Phase 4 eval coverage for reference retrieval, unified pending review, scheduled queue generation, and end-to-end memory-status reporting.
- Added `.ai/README.md` as the central explanation of how session memory, working memory, profiles, learnings, durable memory, references, queues, approvals, and compaction fit together.
- Pruned duplicate AGENTS-style instructions from `.ai/user-profile.md` and `.ai/project-profile.md`, and added profile-side filtering in `extensions/memory-system/profiles.ts` so prompt-ready profiles stay focused on true memory rather than repeated harness rules.
- Hardened Copilot subagent propagation so agent-initiated bash commands always export `PI_SUBAGENT=1`, built-in subagent children receive `PI_SUBAGENT=1` explicitly in `extensions/subagent/index.ts`, and `extensions/memory-system/index.ts` skips automatic memory injection when running under `PI_SUBAGENT=1` to reduce nested request cost.

Eval status:
- `bun scripts/eval-memory-system.ts phase1` — PASS
- `bun scripts/eval-memory-system.ts phase2` — PASS
- `bun scripts/eval-memory-system.ts phase3` — PASS
- `bun scripts/eval-memory-system.ts phase4` — PASS
- `bash scripts/scheduled-learn.sh --dry-run --project scripts/fixtures/memory-system/phase4/project-root --agent-root scripts/fixtures/memory-system/phase4/agent-root` — PASS

Review status:
- Phase 2 repair warning about the refreshed base-package path after pending review is covered by the Phase 3 eval harness.
- Phase 4 review follow-ups on pending durable/profile queue retention, scheduled occurrence deltas, fixture-safe evals, and tracked-work accuracy are now resolved.
- No known critical issues remain in the completed memory-system implementation.

## Next restart step

Feature complete. Start with `.ai/README.md` for the memory-system overview, then use `/memory-status` and inspect `.ai/references/` if follow-up work is needed. If profile duplication appears again, inspect `extensions/memory-system/profiles.ts` and prune AGENTS-style bullets first. After the Copilot subagent hardening change, reload Pi before validating the new `PI_SUBAGENT` propagation behavior because the current session still holds the pre-edit extension runtime.

## Open questions / blockers

- None.

## Promotion candidates

- Durable convention for separating working memory, learnings, durable project memory, profiles, and references inside this Pi configuration.
- Durable convention that profiles should be prompt-ready summaries, while durable facts remain in canonical `.ai/` memory files.
- Durable convention that compaction state must stay validation-gated and source-linked instead of being treated as canonical truth.
