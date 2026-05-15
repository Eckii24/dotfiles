---
description: Orchestrate rough idea → grill → PRD → issues breakdown with tracked feature work (no implementation)
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.
3. Whenever `.ai/current-work.md` exists or is created, keep a **minimal** `Todo Tracker` there with only the major workflow phases. If a `.ai/<slug>-issues.md` exists, keep detailed execution tasks in the issues breakdown instead of duplicating them in `current-work.md`.

## Workflow

### 1. Grill
- The user's rough idea: $@
- Before producing any artifacts, grill the user on this idea following `~/.agents/skills/grill-me/SKILL.md`.
- Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
- If a question can be answered by exploring the codebase, explore the codebase instead.
- Continue until shared understanding is reached — no major open questions remain about scope, constraints, or expected behavior.
- Capture the resolved decisions as input context for the next step.

### 2. PRD
- Delegate to `prd-writer` to create the PRD from the grilled decisions and original idea.
- Pass `.ai/current-work.md` when it exists, the active slug, and the intended PRD path.
- Read the generated PRD file and the sub-agent result.
- Ask remaining open questions with `questionnaire` until none remain.
- Ask the user to confirm the PRD. If they request changes, loop back through `prd-writer`.
- Refresh `.ai/current-work.md` after PRD confirmation: keep the Todo Tracker minimal, mark the major PRD phase complete, and refresh the next restart step.

### 3. Issues Breakdown
- Delegate to `issues-writer` using the confirmed PRD file.
- Pass `.ai/current-work.md` when it exists and the current artifact paths.
- Read the generated issues file and the sub-agent result.
- Ask open questions with `questionnaire` until none remain.
- Ask the user to confirm the breakdown. If they request changes, loop back through `issues-writer`.
- Refresh `.ai/current-work.md` after confirmation: keep the Todo Tracker minimal, mark the major issues phase complete, and keep detailed execution tasks in `.ai/<slug>-issues.md` rather than in `current-work.md`.

### 4. Learning Follow-up
- After the planning work, always run an explicit `subagent` handoff to `learn-orchestrator`, passing `.ai/current-work.md`, the PRD path, the issues file path, changed files if relevant, and any session transcript path that is explicitly available.
- If that handoff hits unresolved collisions or other caller-owned decisions, handle them here with `questionnaire` and the learning runtime, or record an explicit manual follow-up for `/skill:learn review`.
- Refresh `.ai/current-work.md` after the handoff and mark the major learning phase complete.

### 5. Persist Tracked-Work State
- Create or update `.ai/current-work.md` following `project-memory` conventions.
- Record the active slug, PRD path, issues file path, current step, open questions/blockers, and the next restart step.
- Keep the Todo Tracker minimal: major phases only, no detailed task list when an issues file exists.

### 6. Completion
- Ask via `questionnaire` whether the tracked work is complete and should be archived now, or whether it should stay active for later implementation.
- If the user confirms completion, before moving any files update the live `.ai/current-work.md` so both `User confirmed feature complete` and `Active artifacts archived` are checked as the final closeout state, then archive that exact final `.ai/current-work.md` snapshot plus any active `.ai/<slug>-prd.md` and `.ai/<slug>-issues.md` artifacts following `project-memory` conventions.
- If the user does not confirm completion, keep the feature anchor active and leave `User confirmed feature complete` / `Active artifacts archived` unchecked in the Todo Tracker.
- Provide a concise summary with:
  - current-work path
  - PRD file path
  - issues file path
  - learning handoff result
  - whether the feature was archived or left active
  - remaining open questions or next steps
- Tell the user they can continue with `/implement-review` when ready if the feature stays active.
