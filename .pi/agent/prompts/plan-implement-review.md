---
description: Orchestrate story → plan → implement → review → fix until clean with tracked feature work
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. You own the top-level plan → implement → review → repair loop. Keep sub-agents scoped; do not ask them to orchestrate the loop for you.
4. `worker` implements only. Do not ask `worker` to perform the formal review, assign review severities, decide whether the work is approved, or replace the separate `code-reviewer` step.

## Workflow

### 1. Retrieve the Story
- Resolve the story from: $@
- Prefer a dedicated story-retrieval tool if one exists in the environment.
- Otherwise default to Azure DevOps via `az` CLI.
- If the input is an ADO work item URL, extract the numeric work item ID first.
- If org/project context is missing or retrieval fails, use `questionnaire`.
- If the input is clearly a local file path, read it directly.
- Gather enough detail to plan accurately: title, description, acceptance criteria, and linked context/subtasks when available.

### 2. Plan
- Delegate to `plan-writer` using the retrieved story as the requirements source.
- Tell `plan-writer` there is no specification phase for this workflow.
- Pass `.ai/current-work.md` when it exists and the intended plan path.
- Read the generated plan file and the sub-agent result.
- Ask open questions with `questionnaire` until none remain.
- Ask the user to confirm the plan. If they request changes, loop back through `plan-writer`.

### 3. Implement and Review Repair Loop
- Run `worker` to implement against the story, confirmed plan, and `.ai/current-work.md` when it exists.
- Tell `worker` to stop after implementation plus any needed eval/test runs.
- Tell `worker` not to review its own work beyond noting concrete blockers or uncertainties.
- Require explicit changed-file paths, artifact paths, and eval/test results.
- Run `code-reviewer` against the story, the plan file, the changed files, and `.ai/current-work.md` when it exists.
- If the review reports any `Blocking Issues` or `Important Issues`:
  - Create or update `.ai/<slug>-review.md` with the actionable findings.
  - Run another focused `worker` pass to fix those findings.
  - Re-run `code-reviewer` on the updated changes.
  - Repeat until the latest review has no `Blocking Issues` and no `Important Issues`, the user explicitly accepts the remaining issues, or ambiguity requires `questionnaire`.
- Treat `Minor Issues / Suggestions` as optional follow-up work:
  - Apply them when clearly correct, low-risk, and in scope.
  - Otherwise record them in `.ai/<slug>-review.md` or `.ai/current-work.md`.
- Refresh `.ai/current-work.md` after planning, implementation, and review/fix passes following `project-memory` conventions.

### 4. Learning Follow-up
- After meaningful implementation/review work, hand off to `/learn <focus>` if prompt-to-prompt dispatch is available.
- Otherwise record an explicit follow-up for the user to run `/learn <focus>`.
- Use explicit `Learning candidates` from `.ai/current-work.md` as the primary source when available.

### 5. Completion
- Provide a concise final summary with:
  - current-work path
  - story reference / retrieval source
  - plan file path
  - review file path if any
  - changed file list
  - final review outcome / accepted exceptions
  - remaining assumptions or follow-ups
