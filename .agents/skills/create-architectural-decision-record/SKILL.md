---
name: create-architectural-decision-record
description: Create a concise ADR for a durable, consequential architectural decision.
---

# Create Architectural Decision Record

Use only for a durable, consequential choice with considered alternatives and costly reversal. Keep ordinary implementation decisions in the spec, plan, code, or review evidence.

## Inputs

Derive context, decision, alternatives, and consequences from the task and existing artifacts. Read `.ai/current-work.md` and related artifacts when the decision originated in tracked work. Ask only for critical missing information; do not invent rationale, alternatives, or stakeholders.

## Location

Use a task-provided path. Otherwise use `docs/adr/` relative to the repository only when that directory or its convention exists; otherwise ask where to save it. Follow the repository's existing ADR naming convention. Do not write outside the repository root.

## Required format

Follow the local ADR convention. If none exists, use this minimal format:

```md
# ADR-<nnn>: <decision title>

- **Status**: proposed | accepted | superseded
- **Date**: YYYY-MM-DD

## Context
[Constraint or problem that makes this decision necessary.]

## Decision
[Chosen direction and rationale.]

## Consequences
[Benefits, costs, and follow-up constraints.]

## Alternatives considered
- [Alternative] — [why not chosen]
```

Use concise, precise language. Preserve real rationale and rejected alternatives. ADRs are append-only history: supersede old ADRs; do not rewrite them.

## See also

- `project-memory` — tracked-work context and archive rules.
