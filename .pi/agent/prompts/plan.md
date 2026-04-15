---
description: Orchestrate story → plan with tracked feature work (no implementation)
---

You are the **orchestrator**. Keep your own work light: retrieve the story, coordinate, delegate, summarize, and ask the user questions. Substantive work should be done by sub-agents.

## Input
Story reference: $@

## Tracked Work
- Follow the conventions in the `project-memory` skill.
- This prompt produces: `.ai/<slug>-plan.md`.

## Current-work discipline
- Treat `.ai/current-work.md` as a living but bounded evidence log, not just a restart note.
- Capture early pitfalls, rejected options, review-relevant context, and candidate learnings only when they materially help restart or later `/learn` extraction, always with exact evidence paths.
- Keep those sections tight: roughly 3–5 terse items each; merge, compress, or remove stale/resolved noise instead of appending a transcript.

## Workflow

### 0. Retrieve the Story
- Resolve the story from the provided input.
- Prefer a dedicated story-retrieval tool if one exists in the environment.
- If no dedicated tool is available and the user did not specify another source, default to **Azure DevOps via `az` CLI**.
- If the input is an ADO work item URL, extract the numeric work item ID first.
- Use current Azure DevOps CLI defaults if configured; if org/project context is missing or retrieval fails, ask the user via `questionnaire`.
- If the input is clearly a local file path, read it directly.
- Retrieve enough detail to plan implementation accurately: title, description, acceptance criteria, and linked context/subtasks if available.
- Update `.ai/current-work.md` with the story reference/source, active slug, and current step.
- Refresh the bounded evidence-log sections there when story retrieval exposes notable constraints, pitfalls, or likely learning candidates.

### 1. Plan
- Delegate to `plan-writer` using the retrieved story as the source of requirements.
- Tell `plan-writer` there is **no specification phase for this workflow** and that the story is the requirements source.
- Pass `.ai/current-work.md` and the intended plan path into the sub-agent.
- Read the sub-agent result and the generated plan file.
- Update `.ai/current-work.md` with the plan path, current step, and remaining questions.
- Refresh the bounded evidence-log sections there when planning reveals early pitfalls, rejected options, or candidate learnings worth preserving.
- Summarize the plan for the user.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `plan-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the plan before continuing.
- If the user requests changes, loop in `plan-writer` again.

### 2. Completion
- Update `.ai/current-work.md` with the confirmed plan status, linked artifacts, any early high-signal evidence-log notes, and any follow-up notes.
- Do NOT implement. Provide a concise summary with:
  - current-work path
  - story reference / retrieval source
  - plan file path
  - any remaining open questions or next steps
- Tell the user they can continue with `/implement-review` or `/plan-implement-review` when ready. Those workflows now automatically do review → fix → re-review until the latest review is clean or a decision is needed, then hand off to the dedicated canonical `/learn` flow in `prompts/learn.md`. If direct prompt-to-prompt dispatch is unavailable, they should record an explicit follow-up for the user to run `/learn <focus>` instead of improvising a separate learning flow.

## Azure DevOps fallback notes
- Default fallback: use `az` CLI for ADO work item retrieval.
- If needed, ask the user for missing org/project details instead of guessing.
- If the story cannot be fetched, stop and ask the user how to proceed.
