---
description: Orchestrate rough idea → spec → plan with tracked feature work (no implementation)
---

This workflow creates tracked-work artifacts under `.ai/`.

## Setup
1. First read `~/.agents/skills/project-memory/SKILL.md`.
2. If `.ai/current-work.md` exists, read it before delegating.

## Workflow

### 1. Specification
- Delegate to `spec-writer` to create the first draft from: $@
- Pass `.ai/current-work.md` when it exists, the active slug, and the intended spec path.
- Read the generated spec file and the sub-agent result.
- Ask open questions with `questionnaire` until none remain.
- Ask the user to confirm the spec. If they request changes, loop back through `spec-writer`.

### 2. Plan
- Delegate to `plan-writer` using the confirmed spec file.
- Pass `.ai/current-work.md` when it exists and the current artifact paths.
- Read the generated plan file and the sub-agent result.
- Ask open questions with `questionnaire` until none remain.
- Ask the user to confirm the plan. If they request changes, loop back through `plan-writer`.

### 3. Persist Tracked-Work State
- Create or update `.ai/current-work.md` following `project-memory` conventions.
- Record the active slug, spec path, plan path, current step, open questions/blockers, and the next restart step.

### 4. Completion
- Do not implement.
- Provide a concise summary with:
  - current-work path
  - spec file path
  - plan file path
  - remaining open questions or next steps
- Tell the user they can continue with `/implement-review` when ready.
