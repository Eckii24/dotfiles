---
description: Implement bounded work, then run one formal review pass; thin entrypoint over implementation-workflow + code-review-excellence
---

Read and follow:
- `~/.agents/skills/implementation-workflow/SKILL.md`
- `~/.agents/skills/code-review-excellence/SKILL.md`

## Entry-point rules

1. Choose the lightest viable mode:
   - Quick Task
   - Bounded Delivery
   - Tracked Project only when restart/handoff value is real or explicitly requested
2. If `.ai/current-work.md` exists and is relevant, read it. If stale/completed/unrelated, ignore it.
3. Use a narrow `scout` only when repo context is genuinely unclear.
4. Delegate one bounded implementation task to `worker`.
5. Define the review focus before delegation: requirements/spec fidelity, a stated risk, a named concern, or full review.
6. Build a compact review packet from the focus, requirements, changed files, key symbols, and eval/test results.
7. Run at most one independent formal review pass with `code-reviewer`; pass the focus explicitly.
8. Do **not** auto-fix review findings.
9. Only update/archive `.ai/` artifacts in tracked mode, or when the user explicitly wants a review artifact.

## Final summary requirements

Include: mode used, current-work path if used, changed files, review path if created, review mode used, Blocking/Important findings, minor follow-ups, eval/test outcome, archive state if tracked, and assumptions/follow-ups.
State explicitly that implementation and review are complete and that no review findings were auto-fixed.
