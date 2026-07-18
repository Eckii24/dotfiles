---
description: Implement bounded work; thin entrypoint over implementation-workflow
---

Read and follow `~/.agents/skills/implementation-workflow/SKILL.md`.

## Entrypoint rules

1. Choose the lightest viable mode: Quick Task, Bounded Delivery, or Tracked Project only when restart/handoff value is real or explicitly requested.
2. If tracked work is selected or a relevant `.ai/current-work.md` exists, read and follow `~/.agents/skills/project-memory/SKILL.md`. Read only active-phase sections needed now.
3. If `.ai/current-work.md` is stale/completed/unrelated, ignore it; do not inherit it.
4. Extract a compact execution packet from the requirement/plan: objective, acceptance criteria, exact paths/symbols, constraints, and test commands. Do not make every worker reread full artifacts.
5. Work directly when scope is clear. Otherwise use at most one narrow `scout`, then one `worker` owning a coherent vertical slice.
6. Let the worker fix in-scope implementation/type/test failures. Do not spawn one worker per plan bullet, file, or local repair.
7. Validate changed files and real eval/test results yourself. If a material gate fails, diagnose once, make one explicit decision, then rerun once; do not start an open-ended repair chain.
8. Do not auto-run `code-reviewer`; `/implement-review` or `/review` is explicit.
9. Update `.ai/current-work.md` only at material phase boundaries, blockers, or handoff. Only update/archive tracked artifacts in tracked mode.

## Final summary

Include: mode, phase/status, changed files, eval/test evidence, one blocker/decision if any, exact next step, current-work path if used, and review recommendation. Tell user they can run `/implement-review` or `/review` for formal review.
