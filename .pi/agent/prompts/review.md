---
description: Manual formal review only; thin entrypoint over code-review-excellence
---

Read and follow `~/.agents/skills/code-review-excellence/SKILL.md`.

## Entry-point rules

1. Use this only when the user explicitly wants a formal review.
2. If `.ai/current-work.md` exists and is relevant, read it. If stale/completed/unrelated, ignore it.
3. Define the review focus: requirements/spec fidelity, a stated risk, a named concern, or full review.
4. Gather only the compact review context needed for that focus:
   - requirements / acceptance criteria when relevant
   - changed files and key touched symbols
   - eval/test summary
   - current-work / existing review artifact paths when relevant
5. Run one independent formal review pass with `code-reviewer`, passing the focus explicitly, unless the change is low-risk non-code work where an inline checklist is enough.
6. Do **not** auto-fix findings.
7. Only create/update `.ai/<slug>-review.md` when the task is tracked or the user explicitly wants a review artifact.

## Final summary requirements

Include: review path if created, review mode used, remaining Blocking/Important findings, minor follow-ups, eval/test status, and recommended next step.
