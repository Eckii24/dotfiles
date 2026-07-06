---
description: Turn a PRD/spec/story into implementation stories; thin entrypoint over stories-writer + to-stories
---

Default to the lightest workflow that can succeed.

## Setup

1. Decide tracked vs untracked:
   - Untracked by default.
   - Track only when the work is clearly multi-session, there is real restart/handoff value, or the user explicitly wants `.ai/` artifacts.
2. If `.ai/current-work.md` exists and is relevant to this exact task, read it. If stale/completed/unrelated, ignore it.
3. Delegate to `stories-writer` and rely on `~/.agents/skills/to-stories/SKILL.md` for the actual breakdown contract.
4. Prefer vertical, demoable slices. Ask only short blocking questions.

## Workflow

1. Resolve the source: existing PRD, spec, story, or direct request.
2. Delegate to `stories-writer` with:
   - concise source summary
   - source path if known
   - output path if known
   - current-work path only in tracked mode
3. Read back the stories result.
4. If only small wording/scope fixes are needed, edit directly instead of re-running the full loop.
5. Tracked mode only:
   - update `.ai/current-work.md` with stories path, current state, next restart step
   - ask about archive only if this is genuinely tracked work

## Final summary requirements

Include: tracked mode used or not, stories path, open questions, archive state if tracked, and recommended next step.
Recommend `/implement` or `/implement-review` when the user wants execution next.
