---
description: Implement → review → fix → re-review for a tracked feature
---

This workflow assumes tracked feature work and `.ai/` artifacts.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. You own the top-level implement → review → repair loop. Keep sub-agents scoped; do not ask them to orchestrate the loop for you.
4. `worker` implements only. Do not ask `worker` to perform the formal review, assign review severities, decide whether the work is approved, or replace the separate `code-reviewer` step.

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
   - Run another `subagent` chain: focused `worker` fix pass → `code-reviewer` verification pass.
   - Pass the exact review artifact path, changed files, and prior eval/test context into the fix pass.
   - Repeat until the latest review has no `Blocking Issues` and no `Important Issues`, the user explicitly accepts the remaining issues, or ambiguity requires `questionnaire`.
4. Treat `Minor Issues / Suggestions` as optional follow-up work:
   - Apply them when clearly correct, low-risk, and in scope.
   - Otherwise record them in `.ai/<slug>-review.md` or `.ai/current-work.md`.
5. After meaningful implementation/review work:
   - Hand off to `/learn <focus>` if prompt-to-prompt dispatch is available.
   - Otherwise record an explicit follow-up for the user to run `/learn <focus>`.
   - Use explicit `Learning candidates` from `.ai/current-work.md` as the primary source when available.
6. Before finishing:
   - Update `.ai/current-work.md` following `project-memory` conventions.
   - Link changed files, review artifact paths, eval/test results, next step, and any remaining assumptions or follow-ups.

## Completion
Stop when one of these is true:
- the latest review has no `Blocking Issues` and no `Important Issues`
- the user explicitly accepts the remaining issues
- a blocker or ambiguity requires `questionnaire`

Prefer at least one re-review after every fix pass.
