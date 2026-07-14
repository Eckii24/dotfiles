---
name: wayfinder
description: Map a large or unclear initiative into facts, decisions, open frontier, and next work without writing a spec or implementation plan. Use when scope, architecture, dependencies, or sequencing are still genuinely uncertain before creating a spec.
---

# Wayfinder

Use only when the work is too unclear or wide for direct `/spec`. Do not add process to a bounded, understood change.

## Contract

- Discover facts from the repository, existing `.ai/` artifacts, and ADRs before asking.
- Ask only decision-relevant questions. Use the existing `questionnaire` for a batch when several decisions belong together; do not impose one-question rounds.
- Keep the human responsible for product, scope, and architecture choices.
- Write the map to `.ai/<slug>-wayfinder.md` when tracked work is justified or explicitly requested. This local artifact is the source of truth; do not create GitHub issues.
- Do not write a spec, implementation plan, source code, or review. Stop at a decision-ready frontier.

## Map shape

Include only useful sections:

```md
# [Initiative] — Wayfinder

## Objective
## Facts found
## Constraints and non-goals
## Decisions made
## Options still open
## Decision frontier
## Candidate next work
- research | prototype | manual decision | `/spec`
## References
```

## Completion

Finish with one of:

- ready for `/spec`, with the exact path to use;
- one or more bounded research/prototype/manual-decision items;
- blocked, with named decision owner and the missing decision.
