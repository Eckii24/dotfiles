---
name: to-spec
description: Turn current context into a concise implementation spec. Use when a user wants to define what to build, capture requirements, or create a bounded technical/product spec before implementation.
---

# To Spec

Create a spec for `${input:Feature}`. Save to the task-provided output path; if missing, follow `project-memory` artifact conventions.

## Goal

A good spec lets an executor with zero prior context know what to build, why, constraints, and done criteria. Be explicit, concrete, and self-contained. Prefer tables/lists/code blocks over filler. Define domain terms on first use. Include examples and edge cases only when behavior is non-obvious.

## Process

1. Synthesize existing context, code, `CONTEXT.md`, ADRs, and wayfinder output first. Do not start with a broad interview.
2. Ask targeted questions only for critical gaps: scope, constraints, acceptance criteria, and conflicting requirements. Use `questionnaire` when several decisions belong together.
3. Explore the repository when needed; follow established conventions and domain language.
4. Match spec weight to complexity.

## Sizing

| Complexity | Spec weight |
|---|---|
| Small bug/config/single behavior | Problem, solution, acceptance criteria. Skip filler. |
| Medium feature/integration | Scope, decisions, acceptance criteria, key interfaces/examples. |
| Large but bounded system | Definitions, interfaces, edge cases, rationale, risks. |

## Tracked artifacts

Use `.ai/<slug>-spec.md` for tracked work when you control the path. If tracked work is active, follow `project-memory`: keep decisions, rationale, rejected alternatives, and open questions easy to lift into `current-work.md`.

## Template

Include only relevant sections:

````md
---
title: [Concise title]
date_created: [YYYY-MM-DD]
status: Draft | Review | Approved | Deprecated
---

# [Spec title]

## Problem and goal
## Scope
## Constraints and decisions
## Interfaces and data contracts *(if relevant)*
## Examples and edge cases *(if relevant)*
## Testing decisions
## Acceptance criteria
## Out of scope
## Risks and assumptions
## Alternatives considered *(if relevant)*
## Definitions *(if relevant)*
## Open questions *(if any)*
## References
````

## See also

- `to-plan` — turn a bounded spec into an architecture- and code-focused implementation plan.
- `project-memory` — tracked-work lifecycle and archive rules.
