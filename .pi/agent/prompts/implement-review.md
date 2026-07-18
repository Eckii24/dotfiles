---
description: Implement bounded work, then run one formal review pass; thin entrypoint over implementation-workflow + code-review-excellence
---

Read and follow:
- `~/.agents/skills/implementation-workflow/SKILL.md`
- `~/.agents/skills/code-review-excellence/SKILL.md`

## Entry-point rules

1. Choose Quick Task, Bounded Delivery, or Tracked Project only when restart/handoff value is real or explicitly requested.
2. In tracked mode, follow `project-memory`; read only active-phase artifact sections. Ignore stale/completed/unrelated anchors.
3. Build one compact execution packet. Use direct work or at most one narrow scout -> one coherent worker. Do not delegate individual plan bullets, files, or local repairs.
4. The worker fixes in-scope implementation/type/test failures. A material gate gets one diagnosis, one decision, and one rerun; then stop/escalate.
5. Validate changed files and eval/test evidence yourself.
6. Define review focus: requirements/spec fidelity, stated risk, named concern, or full review.
7. Build a compact review packet from focus, changed paths/symbols, and eval evidence. Run at most one independent `code-reviewer` pass.
8. Do not auto-fix review findings. Update `.ai/` only at material phase boundaries, blocker, handoff, or explicit review artifact request.

## Final summary

Include: mode, phase/status, changed files, eval/test outcome, review focus/path, Blocking/Important findings, one blocker/decision if any, exact next step, and archive state if tracked. State that no review findings were auto-fixed.
