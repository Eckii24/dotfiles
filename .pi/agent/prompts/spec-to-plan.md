---
description: Turn a bounded spec into an architecture- and code-focused implementation plan; thin entrypoint over plan-writer + to-plan
---

Default to the lightest workflow that can succeed.

## Setup

1. Decide tracked vs untracked:
   - Untracked by default.
   - Track only when the work is clearly multi-session, there is real restart/handoff value, or the user explicitly wants `.ai/` artifacts.
2. If `.ai/current-work.md` exists and is relevant to this exact task, read it. If stale/completed/unrelated, ignore it.
3. Delegate to `plan-writer` and rely on `~/.agents/skills/to-plan/SKILL.md` for the planning contract.
4. Inspect the repository, existing conventions, and the source spec before deciding architecture. Ask only blocking questions.

## Workflow

1. Resolve the source: an approved/bounded spec or direct request.
2. Delegate to `plan-writer` with:
   - concise source summary
   - source spec path if known
   - repository/context paths and relevant ADRs
   - output path if known
   - current-work path only in tracked mode
3. Read back the plan result.
4. If only small wording/scope fixes are needed, edit directly instead of re-running the full loop.
5. Tracked mode only:
   - update `.ai/current-work.md` with plan path, current state, next restart step
   - ask about archive only if this is genuinely tracked work

## Final summary requirements

Include: tracked mode used or not, plan path, key architecture decision, open questions, archive state if tracked, and recommended next step.
Recommend `/implement` or `/implement-review` when the user wants execution next.
