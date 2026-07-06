---
description: Implement bounded work; thin entrypoint over implementation-workflow
---

Read and follow `~/.agents/skills/implementation-workflow/SKILL.md`.

## Entrypoint rules

1. Choose the lightest viable mode:
   - Quick Task
   - Bounded Delivery
   - Tracked Project only when restart/handoff value is real or explicitly requested
2. If `.ai/current-work.md` exists and is relevant, read it. If stale/completed/unrelated, ignore it.
3. Use a narrow `scout` only when repo context is genuinely unclear.
4. Delegate one bounded implementation task to `worker`.
5. Validate changed files and eval/test results yourself.
6. Do **not** auto-run `code-reviewer` in this flow.
7. Only update/archive `.ai/` artifacts in tracked mode.

## Final summary requirements

Include: mode used, current-work path if used, changed files, eval/test outcome, whether manual review is recommended, archive state if tracked, and assumptions/follow-ups.
Tell the user they can run `/implement-review` or `/review` if they want a formal pass.
