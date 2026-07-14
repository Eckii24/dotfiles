# Architecture Decision Records

Use ADRs only for durable, consequential choices where alternatives were considered and reversal is costly. Ordinary implementation decisions belong in the spec, implementation plan, code, or review evidence instead.

## Minimal format

```md
# ADR-<nnn>: <decision title>

- **Status**: proposed | accepted | superseded
- **Date**: YYYY-MM-DD

## Context
[Constraint or problem that makes this decision necessary.]

## Decision
[Chosen direction, precisely stated.]

## Consequences
[Benefits, costs, and follow-up constraints.]

## Alternatives considered
- [Alternative] — [why not chosen]
```

ADRs are append-only decision history. Supersede an old ADR; do not rewrite history.
