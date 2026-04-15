---
description: Orchestrate story → plan with tracked feature work (no implementation)
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before planning.

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

### 3. Persist Tracked-Work State
- Create or update `.ai/current-work.md` following `project-memory` conventions.
- Record the story reference/source, active slug, plan path, current step, open questions/blockers, and the next restart step.

### 4. Completion
- Do not implement.
- Provide a concise summary with:
  - current-work path
  - story reference / retrieval source
  - plan file path
  - remaining open questions or next steps
- Tell the user they can continue with `/implement-review` or `/plan-implement-review` when ready.
