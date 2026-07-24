---
name: to-plan
description: Turn a bounded functional spec into an implementation plan. Use when architecture, code structure, sequencing, migration, and verification must be decided before implementation.
---

# To Plan

A plan is not a work-item breakdown.

- **Spec:** what and why — feature behavior, use cases, constraints, acceptance criteria, test cases.
- **Plan:** how — architecture, component boundaries, exact files, code/data changes, ordered work, verification, rollout and rollback.

## Process

1. Read the source spec fully. Inspect the repository, ADRs, conventions, and analogous implementation paths before planning.
2. Resolve only critical gaps. Do not invent interfaces, paths, or migrations. State assumptions and open questions explicitly.
3. Make consequential decisions visible: recommendation, rationale, trade-offs, rejected alternatives, and when the decision does not apply.
4. Design the smallest approach that meets the spec. Prefer existing abstractions over new frameworks; apply YAGNI.
5. Write ordered implementation tasks. Every code task names stable ID, non-exhaustive start path/symbol, intended change, tests, verification command with expected signal, and dependency.
6. Include migrations, compatibility, rollout, observability, and rollback only when relevant.
7. Cross-check that every acceptance criterion in the spec has a concrete implementation and verification step.

## Artifact rule

Use `.ai/<slug>-plan.md` for tracked work when you control the artifact path.

## Required structure

```md
# [Feature] — Implementation Plan

## TL;DR / Review Focus
- **Recommendation:**
- **Architecture:**
- **Largest risk:**
- **Stop-gates / open decisions:**

## Source and goal
- Source spec:
- Goal:
- Non-goals:

## Architecture and key decisions

## Component and data-flow design

## File-level change map
| Path | Change | Reason |
|---|---|---|

## Implementation sequence

### Step 1: [stable-id] [title]
- **Objective:**
- **Starts at:** `path:symbol` *(non-exhaustive)*
- **Files:**
- **Change:**
- **Tests / verification:** `command` → expected signal
- **Depends on:**

## Testing strategy

## Migration, rollout, and rollback

## Risks, assumptions, and open questions
```

## Quality bar

- No vague steps such as “add validation” or “update tests”. State exact behavior and paths.
- Keep plan tasks ordered, independently verifiable, and small enough to execute without rediscovery.
- Do not create GitHub issues or external tracker entries unless asked.
- Do not implement, review, or mutate source code while planning.
