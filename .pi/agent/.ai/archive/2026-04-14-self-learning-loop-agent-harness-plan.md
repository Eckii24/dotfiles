---
goal: Implement a layered, file-native memory system for the Pi agent harness that assembles bounded context, approval-gates learning/promotion writes, and keeps `.ai/` artifacts canonical.
date_created: 2026-04-11
status: Planned
tags: feature, memory, pi-extension, tracked-work
---

# Memory System for Pi Agent Harness — Implementation Plan

This plan turns `.ai/self-learning-loop-agent-harness-spec.md` into phased implementation work for the Pi harness at `~/.pi/agent/`. Success means the harness can assemble a bounded memory context from profiles, working memory, learnings, durable project memory, and references; persist only approval-gated durable writes; and preserve restartable state across compaction without introducing new infrastructure.

## Requirements & Constraints

- Keep V1 **Markdown-first** and **file-native** under `.ai/**`; no new npm dependency, vector DB, or graph DB.
- Reuse Pi extension hooks documented in `docs/extensions.md`, especially `session_start`, `before_agent_start`, `session_before_compact`, and `agent_end`.
- Keep `.ai/current-work.md` as the active feature anchor and treat memory artifacts as hints that must be validated against the live workspace before relying on them.
- Use the existing `questionnaire` tool for approval-gated writes to learnings, durable memory, and material profile updates.
- Integrate with existing tracked-work prompts in `prompts/spec-plan-implement-review.md` and `prompts/implement-review.md`.
- Because this repository root is also `~/.pi/agent`, the implementation must physically separate global and project learning stores before any persistence logic lands. Do not collapse both scopes into one physical file in the same-root case.

## Phases

### Phase 1 — Build the context assembly foundation

| Task | Description | Done |
|------|-------------|------|
| 1.1 | Create `extensions/memory-system/` with `index.ts` plus focused helpers such as `paths.ts`, `contracts.ts`, `profiles.ts`, `working-memory.ts`, and `context-package.ts`. Keep Pi-specific hook wiring in `index.ts` and pure ranking/assembly logic in helper modules. | |
| 1.2 | Implement artifact/path resolution for global, project, and feature scopes, including the same-root case for this repo (`~/.pi/agent` == project root). Define and codify the same-root compatibility split so learnings persist to `.ai/global-learning.md` and `.ai/learning.md` here before Phase 2 adds write paths; also define token-budget constants and source-path metadata that later phases can reuse. | |
| 1.3 | Implement the **session-start base package**: read `.ai/user-profile.md`, `.ai/project-profile.md`, and `.ai/current-work.md` when present; assemble a compact summary with explicit source paths; inject it via `session_start`/`before_agent_start` in a bounded format. | |
| 1.4 | Implement the first **task-start augmentation** pass: classify the task, prioritize current-work + durable memory/profile snippets, deduplicate overlaps, and mark factual claims that require skeptical validation against live files before execution. | |
| 1.5 | Add a `/memory-status` extension command that reports which profile/working-memory artifacts were selected, what token budget they consumed, and which sources were skipped. This becomes the operator/debug surface for later phases. | |
| 1.6 | Add fixture-backed eval infrastructure under `scripts/eval-memory-system.ts` and `scripts/fixtures/memory-system/phase1/` so the repo has a deterministic way to verify path resolution (including the same-root split-store mapping), context assembly, token budgeting, and extension load/wiring through `pi`. | |
| 1.7 | Seed missing profile artifacts for this repo with safe templates: `.ai/user-profile.md` and `.ai/project-profile.md`. Keep them concise and source-backed rather than filling them with speculative content. | |

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Phase 1 fixture eval passes | Exit 0 and deterministic pass banner | `bun scripts/eval-memory-system.ts phase1` |

Expected outputs:

**Phase 1 eval**
```text
$ bun scripts/eval-memory-system.ts phase1
PASS memory-system phase1
```

### Phase 2 — Integrate the learning subsystem and approval flow

| Task | Description | Done |
|------|-------------|------|
| 2.1 | Add `extensions/memory-system/learnings.ts` and related helpers to parse, validate, rank, and write learning records in distinct global/project stores. Support the default non-colliding case (`~/.pi/agent/.ai/global-learning.md` + `<project-root>/.ai/learning.md`) and the repo-local same-root override (`.ai/global-learning.md` + `.ai/learning.md`), including occurrence counts, confidence, lineage metadata, and the 30-active-record cap. | |
| 2.2 | Implement the pending recommendation queue in `.ai/pending-learnings.md`, including load/merge/dedup rules and the explicit rule that scheduled/headless discoveries never increment occurrence counts. | |
| 2.3 | Create `agents/learning-analyst.md` as the dedicated memory-analysis subagent prompt. It should read review artifacts, `current-work.md`, and relevant `.ai/` sources, then propose learning records/promotion candidates with exact evidence paths. | |
| 2.4 | Create `prompts/learn.md` for manual `/learn` runs and wire the extension so approved recommendations persist only after `questionnaire` confirmation. Reuse the same persistence path for approvals surfaced at `session_start`. | |
| 2.5 | Update `prompts/spec-plan-implement-review.md` and `prompts/implement-review.md` so the learning-analysis step is available as an optional post-review step without changing the existing default repair loop behavior. | |
| 2.6 | Extend task-start augmentation to merge project-local and global learnings from physically separate stores, prefer project-local matches, deduplicate overlapping guidance, and keep the combined payload within the augmentation budget. | |
| 2.7 | Extend the eval harness and fixtures under `scripts/fixtures/memory-system/phase2/` to verify dual-store resolution, the same-root physical split, approval gating, active-record cap enforcement, and pending-queue handling. | |

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Phase 2 learning eval passes | Exit 0 and deterministic pass banner | `bun scripts/eval-memory-system.ts phase2` |

Expected outputs:

**Phase 2 eval**
```text
$ bun scripts/eval-memory-system.ts phase2
PASS memory-system phase2
```

### Phase 3 — Harden promotion, lifecycle rules, and compaction

| Task | Description | Done |
|------|-------------|------|
| 3.1 | Add `extensions/memory-system/promotions.ts` to classify approved learnings into `.ai/conventions.md`, `.ai/pitfalls.md`, `.ai/decisions/*.md`, `.ai/user-profile.md`, and `.ai/project-profile.md`, with explicit `questionnaire` approval required before any durable write. | |
| 3.2 | Implement stale-learning review logic (90-day validation rule), supersession/extension metadata handling, and profile-update proposals that revise summaries instead of appending endlessly. | |
| 3.3 | Add `extensions/memory-system/compaction.ts` and wire `session_before_compact` so compaction preserves the required state contract: active slug, objective/current state, decisions, blockers, review findings, next restart step, key changed files, and bounded source-linked memory hints. | |
| 3.4 | Implement rehydration helpers so compaction output is treated as a preserved hint set rather than canonical truth, and ensure later session-start/task-start assembly revalidates any live-workspace claims before use. | |
| 3.5 | Add archive/promotion bookkeeping for learning records and profile/durable-memory proposals so archived/superseded items remain understandable from file metadata alone. | |
| 3.6 | Extend `scripts/eval-memory-system.ts` plus `scripts/fixtures/memory-system/phase3/` to verify stale detection, promotion gating, compaction payload shape, and rehydration/validation behavior. | |

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Phase 3 lifecycle + compaction eval passes | Exit 0 and deterministic pass banner | `bun scripts/eval-memory-system.ts phase3` |

Expected outputs:

**Phase 3 eval**
```text
$ bun scripts/eval-memory-system.ts phase3
PASS memory-system phase3
```

### Phase 4 — Add scheduled analysis and reference retrieval hardening

| Task | Description | Done |
|------|-------------|------|
| 4.1 | Add `extensions/memory-system/references.ts` plus helpers for `.ai/references/index.md` and `.ai/references/*.md`, including manifest parsing, relevance ranking, dedup against learnings/profiles, and graceful fallback when references are absent. | |
| 4.2 | Seed the reference layer for this repo with `.ai/references/index.md` and any initial normalized notes needed for fixture coverage; keep source material separate from extracted memory. | |
| 4.3 | Implement `scripts/scheduled-learn.sh` as the scheduled/headless entry point. It should support at least `--dry-run` and write/update `.ai/pending-learnings.md` without auto-approving or incrementing occurrence counts. | |
| 4.4 | Finalize `session_start` handling for pending recommendations so the next interactive session can review scheduled discoveries and promotion/profile proposals via `questionnaire`. | |
| 4.5 | Extend `/memory-status` to surface active profiles, working-memory anchor, learnings, references, pending queue summary, and approximate token usage so the system stays auditable. | |
| 4.6 | Extend the eval harness and fixtures under `scripts/fixtures/memory-system/phase4/` to verify reference retrieval, scheduled-analysis queue generation, and end-to-end context budgeting across all memory layers. | |

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Phase 4 end-to-end memory eval passes | Exit 0 and deterministic pass banner | `bun scripts/eval-memory-system.ts phase4` |
| Scheduled analysis dry-run succeeds | Exit 0 and dry-run banner | `bash scripts/scheduled-learn.sh --dry-run --project scripts/fixtures/memory-system/phase4-project` |

Expected outputs:

**Phase 4 eval**
```text
$ bun scripts/eval-memory-system.ts phase4
PASS memory-system phase4
```

**Scheduled analysis dry-run**
```text
$ bash scripts/scheduled-learn.sh --dry-run --project scripts/fixtures/memory-system/phase4-project
OK scheduled-learn dry-run
```

## Affected Files

- `extensions/memory-system/index.ts` — main hook/command registration and orchestration.
- `extensions/memory-system/paths.ts` — global/project/feature artifact resolution.
- `extensions/memory-system/contracts.ts` — shared types, token budgets, and data contracts.
- `extensions/memory-system/profiles.ts` — profile parsing and summary extraction.
- `extensions/memory-system/working-memory.ts` — `.ai/current-work.md` summary extraction.
- `extensions/memory-system/context-package.ts` — base-package/task-package assembly.
- `extensions/memory-system/learnings.ts` — learning store parse/rank/persist logic.
- `extensions/memory-system/promotions.ts` — promotion/profile update proposal handling.
- `extensions/memory-system/compaction.ts` — compaction preservation and rehydration helpers.
- `extensions/memory-system/references.ts` — reference manifest parsing and retrieval.
- `agents/learning-analyst.md` — subagent for learning extraction and memory analysis.
- `prompts/learn.md` — manual learning-analysis entry point.
- `prompts/spec-plan-implement-review.md` — tracked workflow integration for optional `/learn` step.
- `prompts/implement-review.md` — review workflow integration for optional `/learn` step.
- `scripts/eval-memory-system.ts` — deterministic fixture-backed eval runner.
- `scripts/fixtures/memory-system/**` — eval fixtures for all phases.
- `scripts/scheduled-learn.sh` — headless/scheduled discovery entry point.
- `.ai/user-profile.md` — global compact profile seed/update target.
- `.ai/project-profile.md` — project compact profile seed/update target.
- `.ai/global-learning.md` — same-root global learning store for this repo when `~/.pi/agent` is also the active project root.
- `.ai/learning.md` — same-root project learning store for this repo, kept physically separate from global learnings before persistence logic is enabled.
- `.ai/pending-learnings.md` — queued recommendations awaiting approval.
- `.ai/references/index.md` — reference manifest.
- `.ai/references/*.md` — normalized reference notes.
- `.ai/conventions.md` / `.ai/pitfalls.md` / `.ai/decisions/*.md` — promotion destinations once approved.

## Alternatives Considered

- **Single-file extension (`extensions/memory-system.ts`)** — not chosen because the feature spans multiple orthogonal concerns (path resolution, learnings, compaction, references, scheduled analysis) and would become hard to maintain or test.
- **Only end-to-end evals through live Pi sessions** — not chosen because the repo currently has no dedicated test harness and many rules are deterministic file/selection logic better verified with fixture-backed scripts.
- **Database/vector-store-first implementation** — rejected by the spec; V1 should prove the `.ai/` architecture first.

## Risks & Assumptions

- **Assumption:** For this repo’s same-root case, compatibility paths `.ai/global-learning.md` and `.ai/learning.md` are acceptable physical store names for separating global and project learnings before persistence logic lands.
- **Assumption:** `bun` and `pi` are available locally and can be used by the eval harness without introducing a new dependency manager or package manifest in this repo.
- **Risk:** Markdown parsing can become brittle if artifact templates drift. Mitigation: keep stable templates, preserve exact section headings, and lock behavior with phase fixtures.
- **Risk:** `session_start` approval prompts could become noisy. Mitigation: only prompt when pending queues/proposals actually exist and when UI is available.
- **Risk:** Compaction may over-preserve low-value hints and dilute context quality. Mitigation: enforce the 3–8 hint cap and token accounting in the compaction contract.
- **Risk:** Durable memory can become stale if profiles or conventions are trusted blindly. Mitigation: every injected factual claim must carry source paths and be revalidated against the live workspace before use.

## Open Questions

No open questions — plan is complete.

## References

- Current work anchor: `.ai/current-work.md`
- Confirmed spec: `.ai/self-learning-loop-agent-harness-spec.md`
- Pi extension docs: `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Pi compaction docs: `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md`
- Pi session docs: `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
- Existing extension examples: `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/examples/extensions/custom-compaction.ts`, `extensions/questionnaire.ts`, `extensions/ralph-loop.ts`
