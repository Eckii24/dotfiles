---
description: Implement → review → fix → re-review for a tracked feature
---

This workflow assumes tracked feature work and `.ai/` artifacts.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. You own the top-level implement → review → repair loop. Keep sub-agents scoped; do not ask them to orchestrate the loop for you.
4. `worker` implements only. Do not ask `worker` to perform the formal review, assign review severities, decide whether the work is approved, or replace the separate `code-reviewer` step.
5. Whenever `.ai/current-work.md` exists or is created, keep a **minimal** `Todo Tracker` there with only the major workflow phases. If a `.ai/<slug>-plan.md` exists, keep detailed execution tasks in the plan instead of duplicating them in `current-work.md`.

## Workflow
Use the `subagent` tool with the `chain` parameter for each implementation/review or repair/review sequence.

1. Run `worker` to implement: $@
   - Pass `.ai/current-work.md` when it exists.
   - Tell `worker` to stop after implementation plus any needed eval/test runs.
   - Tell `worker` not to review its own work beyond noting concrete blockers or uncertainties.
   - Require explicit changed-file paths, artifact paths, and eval/test results.
2. Run `code-reviewer` on the implementation result (`{previous}`).
   - Pass `.ai/current-work.md` when it exists.
   - Require explicit file paths and eval/test results in the review output.
3. If the review reports any `Blocking Issues` or `Important Issues`:
   - Create or update `.ai/<slug>-review.md` with the actionable findings.
   - Keep that review artifact as a cumulative ledger: preserve the original findings, append fix/verification notes, and do not delete resolved issues before learn extraction has mined them.
   - Mirror high-signal resolved findings into `.ai/current-work.md` under `Review findings & fixes` or `Learning candidates` when they are worth preserving beyond the review artifact.
   - Run another `subagent` chain: focused `worker` fix pass → `code-reviewer` verification pass.
   - Pass the exact review artifact path, changed files, and prior eval/test context into the fix pass.
   - Repeat until the latest review has no `Blocking Issues` and no `Important Issues`, the user explicitly accepts the remaining issues, or ambiguity requires `questionnaire`.
4. Treat `Minor Issues / Suggestions` as optional follow-up work:
   - Apply them when clearly correct, low-risk, and in scope.
   - Otherwise record them in `.ai/<slug>-review.md` or `.ai/current-work.md`.
5. After meaningful work, always run an explicit `subagent` handoff to `learn-orchestrator`, passing `.ai/current-work.md`, the review artifact path if any, changed files, and any session transcript path that is explicitly available.
   - If that handoff hits unresolved collisions or other caller-owned decisions, handle them here with `questionnaire` and the learning runtime, or record an explicit manual follow-up for `/skill:learn review`.
   - Use explicit `Learning candidates` from `.ai/current-work.md` as the primary source when available.
   - Refresh `.ai/current-work.md` after the handoff and mark the major learning phase complete.
6. Before finishing:
   - Update `.ai/current-work.md` following `project-memory` conventions.
   - Keep the Todo Tracker minimal: major phases only, no detailed checklist when a plan file exists.
   - Link changed files, review artifact paths, eval/test results, next step, and any remaining assumptions or follow-ups.
7. Ask via `questionnaire` whether the tracked work is complete and should be archived now.
   - If the user confirms completion, before moving any files update the live `.ai/current-work.md` so both `User confirmed feature complete` and `Active artifacts archived` are checked as the final closeout state, then archive that exact final `.ai/current-work.md` snapshot plus any active `.ai/<slug>-review.md`, `.ai/<slug>-plan.md`, and related tracked-work artifacts following `project-memory` conventions.
   - If the user does not confirm completion, keep the feature anchor active and leave `User confirmed feature complete` / `Active artifacts archived` unchecked in the Todo Tracker.

## Completion
Stop when one of these is true:
- the latest review has no `Blocking Issues` and no `Important Issues`
- the user explicitly accepts the remaining issues
- a blocker or ambiguity requires `questionnaire`

Prefer at least one re-review after every fix pass.
