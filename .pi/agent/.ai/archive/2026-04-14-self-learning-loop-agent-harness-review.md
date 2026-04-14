# Memory System for Pi Agent Harness — Review

- **Slug**: self-learning-loop-agent-harness
- **Phase**: Phase 2
- **Updated**: 2026-04-11
- **Status**: Clean of critical issues; one follow-up warning remains

## Scope reviewed
- `extensions/memory-system/index.ts`
- `extensions/memory-system/learnings.ts`
- `extensions/memory-system/context-package.ts`
- `extensions/memory-system/contracts.ts`
- `extensions/memory-system/pending-review.ts`
- `scripts/eval-memory-system.ts`
- `agents/learning-analyst.md`
- `prompts/learn.md`
- `prompts/implement-review.md`
- `prompts/spec-plan-implement-review.md`
- `.ai/global-learning.md`
- `.ai/learning.md`
- `.ai/pending-learnings.md`
- `scripts/fixtures/memory-system/phase2/**`

## Eval results
- `bun scripts/eval-memory-system.ts phase1` — PASS
- `bun scripts/eval-memory-system.ts phase2` — PASS

## Critical Issues (Must Fix)
- None.

## Warnings (Should Fix)
- `scripts/eval-memory-system.ts` still does not exercise the full `session_start` → `/learn review ...` → `agent_end` base-package refresh path. The runtime logic exists, but the new refresh/resend flow is not yet protected by a dedicated eval.

## Suggestions (Consider)
- Add a focused regression check for the pending-review refresh flow before or during Phase 4 hardening.
- Consider surfacing promotion-eligible learnings once Phase 3 adds promotions/staleness handling.

## Summary
Phase 2 storage, queueing, dedupe, shared persistence, and prompt integration are in place. The remaining follow-up is test coverage for the newest session-start refresh behavior, not a correctness blocker for the implemented Phase 2 scope.
