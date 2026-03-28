---
description: Orchestrate rough idea → spec → plan → implement → review with tracked feature work
---

You are the **orchestrator**. Keep your own work light: coordinate, delegate, summarize, and ask the user questions. Substantive work should be done by sub-agents.

## Input
Rough idea: $@

## Tracked Work
- Follow the conventions in the `tracked-work` skill.
- This prompt produces: `.ai/<slug>-spec.md`, `.ai/<slug>-plan.md`, `.ai/<slug>-review.md`.

## Workflow

### 1. Specification
- Delegate to `spec-writer` to create the first draft from the rough idea.
- Pass `.ai/current-work.md`, the active slug, and the intended spec path into the sub-agent.
- Read the sub-agent result and the generated spec file.
- Update `.ai/current-work.md` with the spec path, current step, and open questions.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `spec-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the spec before continuing.
- If the user requests changes, loop in `spec-writer` again.

### 2. Plan
- Delegate to `plan-writer` using the confirmed spec file.
- Pass `.ai/current-work.md` and the current artifact paths.
- Read the sub-agent result and the generated plan file.
- Update `.ai/current-work.md` with the plan path, current step, and remaining questions.
- Summarize the plan for the user.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `plan-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the plan before continuing.
- If the user requests changes, loop in `plan-writer` again.

### 3. Implement and Review Loop
- Delegate implementation to `worker` using the confirmed spec, plan, and `.ai/current-work.md`.
- Require the worker to report changed files, `.ai/` artifact paths, and eval/test results.
- Update `.ai/current-work.md` with changed files, evals, and the next step.
- If blockers or ambiguities appear, bring them back to the user via `questionnaire`.
- Delegate review to `code-reviewer` using the spec file, plan file, changed files, and `.ai/current-work.md`.
- Summarize the review for the user and ask what to do with the findings:
  - fix critical issues only
  - fix critical issues + warnings
  - fix everything including suggestions
  - accept as-is
  - custom instruction
- Record the review outcome in `.ai/current-work.md` and create or update `.ai/<slug>-review.md` when needed.
- If fixes are requested, delegate another focused `worker` pass with the relevant spec/plan/review artifact paths, then re-run `code-reviewer` as needed.
- Repeat until the user is satisfied.

### 4. Completion
- Update `.ai/current-work.md` with final status, linked artifacts, changed files, and handoff notes.
- Provide a concise final summary with:
  - current-work path
  - spec file path
  - plan file path
  - review file path if any
  - changed file list
  - final review outcome
  - any remaining assumptions / follow-ups
