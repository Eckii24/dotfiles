# Memory System Demo

- **Slug**: memory-system-demo
- **Status**: Done
- **Started**: 2026-04-14
- **Updated**: 2026-04-14

## Objective

Demonstrate the memory system in action with working memory, learnings, pending queues, and promotion flow.

## Decisions & rationale

- Use AGENTS.md as the single durable memory target instead of separate convention/pitfall files.
- Keep learning stores as the incubation layer with structured metadata.

## Current state

The learning-system rewrite is complete. The repo now uses `extensions/learning-system/` instead of the old monolithic memory-system learning surface. Runtime-backed `/learn` creation/review flows, one-file-per-learning storage, pending generation/review, AGENTS.md promotion with confirmation tokens, orchestrator + sub-agent learning injection, and the new eval harness are all in place.

## Next restart step

If this work is revisited, start by rerunning `bun scripts/eval-learning-system.ts all`, then do a manual interactive smoke test for the collapsed learning-injection UI and a prompt-level `/learn review` pass.

## Review outcome

- Latest `code-reviewer` pass: no Critical Issues, no Warnings.
- Remaining follow-up is optional: manual TUI smoke test for collapsed/expandable learning injection.

## Changed files

- `agents/learning-analyst.md`
- `prompts/learn.md`
- `prompts/spec-plan-implement-review.md`
- `prompts/implement-review.md`
- `extensions/learning-system/contracts.ts`
- `extensions/learning-system/index.ts`
- `extensions/learning-system/inject.ts`
- `extensions/learning-system/markdown.ts`
- `extensions/learning-system/paths.ts`
- `extensions/learning-system/promotion.ts`
- `extensions/learning-system/README.md`
- `extensions/learning-system/review.ts`
- `extensions/learning-system/runtime.ts`
- `extensions/learning-system/scan.ts`
- `extensions/learning-system/store.ts`
- `scripts/eval-learning-system.ts`
- `scripts/fixtures/learning-system/README.md`

## Open questions / blockers

- None.

## Linked artifacts

- Spec: `.ai/memory-system-demo-spec.md`
- Plan: `.ai/memory-system-demo-plan.md`
- Review: `.ai/memory-system-demo-review.md`
- Eval: `scripts/eval-learning-system.ts`
