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
6. Declare exactly one review focus: `plan/spec`, `correctness`, `security`, `performance`, `tests`, `maintainability`, `architecture`, or `full`. Use `plan/spec` for implementation fidelity; reserve `full` for deliberate broad review.
7. Build a compact review packet from focus, changed paths/symbols, and eval evidence. For any source-code, test, configuration, infrastructure, or schema change, MUST launch exactly one independent `code-reviewer` pass after implementation verification. Do not substitute an inline review. Skip only documentation-only or formatting-only changes, or when user explicitly says no review. If launch fails, report `review not run` with reason; never imply review completed.
8. Reviewer packet contains only fixed point, exactly one focus, changed paths/symbols, acceptance criteria, and eval evidence. Do not forward full implementation output, files, diffs, or logs.
9. Do not auto-fix review findings. Update `.ai/` only at material phase boundaries, blocker, handoff, or explicit review artifact request.

## Final summary

Include: mode, phase/status, changed files, eval/test outcome, review focus/path, Blocking/Important findings, one blocker/decision if any, exact next step, and archive state if tracked. State that no review findings were auto-fixed.
