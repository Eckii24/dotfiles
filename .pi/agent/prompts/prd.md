---
description: Create or refine a PRD/spec only; thin entrypoint over prd-writer + to-prd
---

Default to the lightest workflow that can succeed.

## Setup

1. Decide tracked vs untracked:
   - Untracked by default.
   - Track only when the work is clearly multi-session, there is real restart/handoff value, or the user explicitly wants `.ai/` artifacts.
2. If `.ai/current-work.md` exists and is relevant to this exact task, read it. If stale/completed/unrelated, ignore it.
3. Delegate to `prd-writer` and rely on `~/.agents/skills/to-prd/SKILL.md` for the actual PRD contract.
4. Ask only blocking questions. Prefer repo/context inspection over unnecessary interviewing.

## Workflow

1. Synthesize the request, relevant code, and constraints.
2. Delegate to `prd-writer` with:
   - concise feature/problem summary
   - known constraints and acceptance criteria
   - output path if known
   - current-work path only in tracked mode
3. Read back the PRD result.
4. If only small wording/scope fixes are needed, edit directly instead of re-running the full loop.
5. Tracked mode only:
   - update `.ai/current-work.md` with PRD path, current state, next restart step
   - ask about archive only if this is genuinely tracked work

## Final summary requirements

Include: tracked mode used or not, PRD path, open questions, archive state if tracked, and recommended next step.
Recommend `/prd-to-stories` when the user wants execution slices next.
