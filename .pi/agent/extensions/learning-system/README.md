# Learning System

Learning-centered extension for one-file-per-learning storage, injection, and review.

## What it does

- Scans approved learnings from one-file-per-learning stores:
  - Project: `<project-root>/.ai/learnings/*.md`
  - Global: `~/.agents/learnings/*.md`
- Injects **all approved learnings** as lightweight refs (`filename + summary`) for both the orchestrator and sub-agents.
- Prompts the orchestrator to run `/learn review` when pending learnings exist.
- Deletes the obsolete monolithic learning stores and proposal queue on first use instead of attempting migration.

## Runtime layout

```text
~/.agents/
  learnings/
    *.md
    pending/
      *.md

<project-root>/
  .ai/
    learnings/
      *.md
      pending/
        *.md
  AGENTS.md
```

## Injection format

```text
Memory · learnings · N refs
Treat learning refs as hints; validate live workspace facts before relying on them.
Project (.ai/learnings):
- validate-memory-hints.md — Validate memory-derived claims against live files before relying on them.
Global (~/.agents/learnings):
- concise-questionnaire-options.md — Keep questionnaire labels short; use descriptions for extra context.
```

The custom message renderer keeps the block visible in the TUI. Sub-agents receive the same injected block, but they never trigger the interactive pending-review prompt.

## Runtime tools

The extension also exposes runtime-backed tools so the live `/learn` flow uses the same helper logic as the tested implementation:

- `learning_write_pending` — create pending files with canonical slugging, body normalization, and collision handling
- `learning_resolve_pending_collision` — resolve creation-time Merge/Replace/Skip collisions against existing files
- `learning_resolve_review_collision` — resolve review-time collisions surfaced by approve/move/normalize actions
- `learning_review_queue` — load pending/existing review order, recommendations, and normalization proposals
- `learning_promotion_preview` — build the compacted AGENTS.md preview, target section, and required confirmation token
- `learning_apply_review_action` — apply keep/move/reject/remove/consolidate/normalize/promote decisions

## `/learn`

`/learn` now has exactly two modes:

1. `/learn [focus]`
   - Delegates discovery to `agents/learning-analyst.md`
   - Writes candidates directly to `.ai/learnings/pending/`
   - Checks for slug collisions against pending + approved files
   - Offers `/learn review` afterward
2. `/learn review`
   - Reviews pending learnings first
   - Optionally reviews approved learnings next
   - Runs normalization checks last
   - Handles AGENTS.md promotion, consolidation, and deletion from one flow

## Promotion

Promotion goes straight from a learning file into `AGENTS.md` after explicit confirmation. The runtime now requires a `confirmationToken` from `learning_promotion_preview`, so direct `promote` calls without a confirmed preview fail. The learning is compacted into a concise directive, placed into the best-fitting section when possible, deduplicated, and then the learning file is deleted.

## Same-root case

This repo is both the agent root and project root. That does **not** change learning storage:

- Global learnings: `~/.agents/learnings/`
- Project learnings: `.ai/learnings/`
- Global AGENTS target: `~/.pi/agent/AGENTS.md`
- Project AGENTS target: `<project-root>/AGENTS.md`
