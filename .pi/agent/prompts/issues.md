---
description: Orchestrate story → issues breakdown with tracked feature work (no implementation)
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. Whenever `.ai/current-work.md` exists or is created, keep a **minimal** `Todo Tracker` there with only the major workflow phases. If a `.ai/<slug>-issues.md` exists, keep detailed execution tasks in the issues breakdown instead of duplicating them in `current-work.md`.

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

### 3. Learning Follow-up
- After the planning work, always run an explicit `subagent` handoff to `learn-orchestrator`, passing `.ai/current-work.md`, the story reference, the issues file path, changed files if relevant, and any session transcript path that is explicitly available.
- If that handoff hits unresolved collisions or other caller-owned decisions, handle them here with `questionnaire` and the learning runtime, or record an explicit manual follow-up for `/skill:learn review`.
- Refresh `.ai/current-work.md` after the handoff and mark the major learning phase complete.

### 4. Persist Tracked-Work State
- Create or update `.ai/current-work.md` following `project-memory` conventions.
- Record the story reference/source, active slug, issues file path, current step, open questions/blockers, and the next restart step.
- Keep the Todo Tracker minimal: major phases only, no detailed task list when an issues file exists.

### 5. Completion
- Ask via `questionnaire` whether the tracked work is complete and should be archived now, or whether it should stay active for later implementation.
- If the user confirms completion, before moving any files update the live `.ai/current-work.md` so both `User confirmed feature complete` and `Active artifacts archived` are checked as the final closeout state, then archive that exact final `.ai/current-work.md` snapshot plus any active `.ai/<slug>-issues.md` artifacts following `project-memory` conventions.
- If the user does not confirm completion, keep the feature anchor active and leave `User confirmed feature complete` / `Active artifacts archived` unchecked in the Todo Tracker.
- Provide a concise summary with:
  - current-work path
  - story reference / retrieval source
  - issues file path
  - learning handoff result
  - whether the feature was archived or left active
  - remaining open questions or next steps
- Tell the user they can continue with `/implement-review` when ready if the feature stays active.
