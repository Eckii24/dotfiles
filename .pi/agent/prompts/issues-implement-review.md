---
description: Orchestrate story → issues → implement → review → fix until clean with tracked feature work
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. You own the top-level issues → implement → review → repair loop. Keep sub-agents scoped; do not ask them to orchestrate the loop for you.
4. `worker` implements only. Do not ask `worker` to perform the formal review, assign review severities, decide whether the work is approved, or replace the separate `code-reviewer` step.
5. Whenever `.ai/current-work.md` exists or is created, keep a **minimal** `Todo Tracker` there with only the major workflow phases. If a `.ai/<slug>-issues.md` exists, keep detailed execution tasks in the issues breakdown instead of duplicating them in `current-work.md`.

## Workflow

### 1. Retrieve the Story
- Resolve the story from: $@
- Prefer a dedicated story-retrieval tool if one exists in the environment.
- Otherwise default to Azure DevOps via `az` CLI.
- If the input is an ADO work item URL, extract the numeric work item ID first.
- If org/project context is missing or retrieval fails, use `questionnaire`.
- If the input is clearly a local file path, read it directly.
- Gather enough detail to break down accurately: title, description, acceptance criteria, and linked context/subtasks when available.

### 2. Issues Breakdown
- Delegate to `issues-writer` using the retrieved story as the requirements source.
- Tell `issues-writer` there is no PRD phase for this workflow.
- Pass `.ai/current-work.md` when it exists and the intended issues file path.
- Read the generated issues file and the sub-agent result.
- Ask open questions with `questionnaire` until none remain.
- Ask the user to confirm the breakdown. If they request changes, loop back through `issues-writer`.
- Refresh `.ai/current-work.md` after confirmation: keep the Todo Tracker minimal, mark the major issues phase complete, and keep detailed execution tasks in `.ai/<slug>-issues.md` rather than in `current-work.md`.

### 3. Implement and Review Repair Loop
- Run `worker` to implement against the story, confirmed issues breakdown, and `.ai/current-work.md` when it exists.
- Tell `worker` to stop after implementation plus any needed eval/test runs.
- Tell `worker` not to review its own work beyond noting concrete blockers or uncertainties.
- Require explicit changed-file paths, artifact paths, and eval/test results.
- Run `code-reviewer` against the story, the issues file, the changed files, and `.ai/current-work.md` when it exists.
- If the review reports any `Blocking Issues` or `Important Issues`:
  - Create or update `.ai/<slug>-review.md` with the actionable findings.
  - Keep that review artifact as a cumulative ledger: preserve the original findings, append fix/verification notes, and do not delete resolved issues before learn extraction has mined them.
  - Mirror high-signal resolved findings into `.ai/current-work.md` under `Review findings & fixes` or `Learning candidates` when they are worth preserving beyond the review artifact.
  - Run another focused `worker` pass to fix those findings.
  - Re-run `code-reviewer` on the updated changes.
  - **Iteration budget**: run at most 3 fix → re-review cycles. If blocking issues remain after 3 cycles, stop and present remaining issues via `questionnaire` for the user to triage (accept, defer, or continue with manual guidance).
  - **Scoped fix passes**: send only unresolved `Blocking Issues` and `Important Issues` from the latest review to the worker — not the full cumulative review artifact. Reference specific file:line locations.
  - Repeat until the latest review has no `Blocking Issues` and no `Important Issues`, the user explicitly accepts the remaining issues, the iteration budget is exhausted, or ambiguity requires `questionnaire`.
- Treat `Minor Issues / Suggestions` as optional follow-up work:
  - Apply them when clearly correct, low-risk, and in scope.
  - Otherwise record them in `.ai/<slug>-review.md` or `.ai/current-work.md`.
- Refresh `.ai/current-work.md` after issues breakdown, implementation, and review/fix passes following `project-memory` conventions.
- Keep the Todo Tracker minimal throughout: major phases only, no detailed task checklist when an issues file exists.

### 4. Learning Follow-up
- After meaningful work, always run an explicit `subagent` handoff to `learn-orchestrator`, passing `.ai/current-work.md`, the review artifact path if any, changed files, and any session transcript path that is explicitly available.
- If that handoff hits unresolved collisions or other caller-owned decisions, handle them here with `questionnaire` and the learning runtime, or record an explicit manual follow-up for `/skill:learn review`.
- Use explicit `Learning candidates` from `.ai/current-work.md` as the primary source when available.
- Refresh `.ai/current-work.md` after the handoff and mark the major learning phase complete.

### 5. Completion
- After the learning handoff, ask via `questionnaire` whether the tracked work is complete and should be archived now.
- If the user confirms completion:
  - before moving any files, update the live `.ai/current-work.md` so both `User confirmed feature complete` and `Active artifacts archived` are checked as the final closeout state
  - archive that exact final `.ai/current-work.md` snapshot plus any active `.ai/<slug>-issues.md` and `.ai/<slug>-review.md` artifacts following `project-memory` conventions
- If the user does not confirm completion:
  - keep the feature anchor active
  - leave `User confirmed feature complete` and `Active artifacts archived` unchecked in the Todo Tracker
  - refresh the next restart step
- Provide a concise final summary with:
  - current-work path
  - story reference / retrieval source
  - issues file path
  - review file path if any
  - changed file list
  - final review outcome / accepted exceptions
  - learning handoff result
  - whether the feature was archived or left active
  - remaining assumptions or follow-ups
