---
description: Orchestrate rough idea → spec → plan with tracked feature work (no implementation)
---

You are the **orchestrator**. Keep your own work light: coordinate, delegate, summarize, and ask the user questions. Substantive work should be done by sub-agents.

## Input
Rough idea: $@

## Tracked Work
- Follow the conventions in the `project-memory` skill.
- This prompt produces: `.ai/<slug>-spec.md`, `.ai/<slug>-plan.md`.

## Current-work discipline
- Treat `.ai/current-work.md` as a living but bounded evidence log, not just a restart note.
- Capture early pitfalls, rejected options, review-relevant context, and candidate learnings only when they materially help restart or later `/learn` extraction, always with exact evidence paths.
- Keep those sections tight: roughly 3–5 terse items each; merge, compress, or remove stale/resolved noise instead of appending a transcript.

## Workflow

### 1. Specification
- Delegate to `spec-writer` to create the first draft from the rough idea.
- Pass `.ai/current-work.md`, the active slug, and the intended spec path into the sub-agent.
- Read the sub-agent result and the generated spec file.
- Update `.ai/current-work.md` with the spec path, current step, and open questions.
- Refresh the bounded evidence-log sections there when specification work reveals early pitfalls, rejected options, or candidate learnings worth preserving.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `spec-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the spec before continuing.
- If the user requests changes, loop in `spec-writer` again.

### 2. Plan
- Delegate to `plan-writer` using the confirmed spec file.
- Pass `.ai/current-work.md` and the current artifact paths.
- Read the sub-agent result and the generated plan file.
- Update `.ai/current-work.md` with the plan path, current step, and remaining questions.
- Refresh the bounded evidence-log sections there when planning reveals early pitfalls, rejected options, or candidate learnings worth preserving.
- Summarize the plan for the user.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `plan-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the plan before continuing.
- If the user requests changes, loop in `plan-writer` again.

### 3. Completion
- Update `.ai/current-work.md` with the confirmed spec and plan status, linked artifacts, any early high-signal evidence-log notes, and any follow-up notes.
- Do NOT implement. Provide a concise summary with:
  - current-work path
  - spec file path
  - plan file path
  - any remaining open questions or next steps
- Tell the user they can continue with `/implement-review` when ready. That workflow now automatically does review → fix → re-review until the latest review is clean or a decision is needed, then hands off to the dedicated canonical `/learn` flow in `prompts/learn.md`. If direct prompt-to-prompt dispatch is unavailable, it should record an explicit follow-up for the user to run `/learn <focus>` instead of improvising a separate learning flow.
