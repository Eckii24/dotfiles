---
name: create-implementation-plan
description: 'Create a new implementation plan file for new features, refactoring existing code or upgrading packages, design, architecture or infrastructure.'
---

# Create Implementation Plan

Create an implementation plan for `${input:PlanPurpose}`.

Save the plan to the output path provided in the task. If no explicit path is given, follow `tracked-work` skill conventions.

## What makes a good plan

A good plan lets an agent or human execute confidently without guessing. The best plans are:

- **Concrete**: name files, functions, and components — not abstractions.
- **Right-sized**: a 3-task bugfix gets a short plan. A multi-phase feature gets phases. Match the weight of the plan to the weight of the work.
- **Verifiable**: every phase ends with an eval gate — the exact commands and expected output that prove it's done. Evals are not optional.
- **Honest about uncertainty**: call out risks, assumptions, and open questions explicitly instead of pretending they don't exist.

## Before writing: plan or clarify

If the requirements are ambiguous, incomplete, or missing critical context — **ask clarifying questions first** instead of producing a plan full of guesses. A short, targeted question set is better than a detailed plan built on wrong assumptions.

When you have enough clarity, produce the plan.

## Sizing guidance

Not every task needs the same plan structure. Match the ceremony to the complexity:

| Complexity | What the plan looks like |
|---|---|
| **Small** (single-file fix, config change) | A short task list with one eval gate. Skip Alternatives, Dependencies, Risks unless relevant. |
| **Medium** (feature touching 3-10 files) | 2-3 phases with eval gates. Include affected files and any non-obvious constraints. |
| **Large** (multi-system, multi-day) | Full phased plan with dependencies, risks, alternatives, and thorough eval gates. |

## Eval gates

Every phase must end with an eval gate. An eval gate contains:
- The exact command to run
- The exact output that proves success

Evals are the proof. If you can't define how to verify a phase is done, the phase isn't well-defined enough.

## Integration with `tracked-work` and `project-memory`

If tracked feature work is active, use `tracked-work` as the source of truth for `.ai/current-work.md` structure, feature artifact conventions, archive behavior, and promotion review.

Use this plan for **execution structure**, not as the running context record:
- record phase learnings, major decisions, and restart state in `.ai/current-work.md`
- keep project memory read-mostly during implementation
- use `project-memory` at feature completion to decide what gets promoted into durable memory or ADRs

## Accumulated learnings

When a plan has multiple phases, later phases may depend on discoveries from earlier ones. If Phase 1 reveals patterns, conventions, or constraints that affect Phase 2, note them as **Learnings** at the end of the phase so the executor carries that context forward.

If tracked work is active, sync those learnings into `.ai/current-work.md` following `tracked-work` conventions.

## See also

- `tracked-work` — active feature anchor, artifact paths, archive, promotion review
- `project-memory` — durable project memory and promotion criteria

## Template

Include only the sections relevant to the scope. Sections marked *(if relevant)* should be skipped when they'd just contain filler.

```md
---
goal: [What this plan achieves — one sentence]
date_created: [YYYY-MM-DD]
status: Planned | In progress | Completed | On Hold | Deprecated
tags: [optional, e.g. feature, bugfix, refactor, migration]
---

# [Plan title]

[1-3 sentences: what, why, and what success looks like.]

## Requirements & Constraints *(if relevant)*

[Only list requirements and constraints that materially affect implementation decisions. Skip if the spec or story already covers them.]

- Requirement or constraint — why it matters for this plan
- ...

## Phases

### Phase 1 — [Goal of this phase]

| Task | Description | Done |
|------|-------------|------|
| 1.1 | [Concrete task: file paths, function names, what changes] | |
| 1.2 | [Next task] | |

#### Eval Gate

[Every criterion must pass before the next phase.]

| What | Target | Command |
|------|--------|---------|
| [e.g., Unit tests pass] | [e.g., 0 failures] | `npm test` |
| [e.g., Build succeeds] | [e.g., exit 0] | `npm run build` |

Expected outputs:

**[Eval name]**
```
$ [exact command]
[exact expected output]
```

#### Learnings *(if any)*

[Patterns, conventions, constraints, or decisions discovered during this phase that affect later phases. If the work is tracked, sync these into `.ai/current-work.md`.]

### Phase 2 — [Goal of this phase]

[Same structure. Add more phases as needed.]

## Affected Files *(if relevant)*

[Skip if the task list already makes this obvious.]

- `path/to/file.ts` — what changes
- ...

## Alternatives Considered *(if relevant)*

[Include when a non-obvious choice was made.]

- Alternative approach — why not chosen
- ...

## Dependencies *(if relevant)*

- Dependency — what it's needed for
- ...

## Risks & Assumptions

- Risk or assumption — impact if wrong
- ...

## Open Questions *(if any)*

[Questions that surfaced during planning but couldn't be resolved without more input.]

- Question — why it matters for the plan
- ...

## References

[Links to specs, ADRs, docs, stories.]
```
