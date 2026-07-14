---
description: Create or refine a spec only; thin entrypoint over spec-writer + to-spec
---

Default to the lightest workflow that can succeed.

## Setup

1. Decide tracked vs untracked:
   - Untracked by default.
   - Track only when the work is clearly multi-session, there is real restart/handoff value, or the user explicitly wants `.ai/` artifacts.
2. If `.ai/current-work.md` exists and is relevant to this exact task, read it. If stale/completed/unrelated, ignore it.
3. Delegate to `spec-writer` and rely on `~/.agents/skills/to-spec/SKILL.md` for the actual spec contract.
4. Ask only blocking questions. Prefer repository/context inspection and the existing `questionnaire` over unnecessary interviewing.

## Workflow

1. Synthesize the request, relevant code, constraints, and any wayfinder output.
2. Delegate to `spec-writer` with:
   - concise feature/problem summary
   - known constraints and acceptance criteria
   - wayfinder path when present
   - output path if known
   - current-work path only in tracked mode
3. Read back the spec result.
4. If only small wording/scope fixes are needed, edit directly instead of re-running the full loop.
5. Tracked mode only:
   - update `.ai/current-work.md` with spec path, current state, next restart step
   - ask about archive only if this is genuinely tracked work

## Final summary requirements

Include: tracked mode used or not, spec path, open questions, archive state if tracked, and recommended next step.
Recommend `/spec-to-plan` when the user wants an architecture- and code-focused implementation plan next.
