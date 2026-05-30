---
name: to-prd
description: 'Turn the current context into a Product Requirements Document. Use when user wants to create a PRD, define what to build, capture requirements, or produce a spec for a feature.'
---

# To PRD

Create a PRD for `${input:Feature}`. Save to task-provided output path; if missing, follow `project-memory` artifact conventions.

## Goal

A good PRD lets an executor with zero prior context know what to build, why, for whom, and done criteria. Be explicit, concrete, self-contained. Prefer tables/lists/code blocks over prose. Define domain terms first use. Include examples/edge cases only when behavior is non-obvious.

## Process

1. Synthesize from existing context/code/docs first. Do not start with a broad interview.
2. Ask only short targeted questions for critical gaps: scope, constraints, acceptance criteria, conflicting requirements.
3. Explore repo if needed; follow existing conventions/domain language/ADRs.
4. Write PRD at weight matching complexity.

## Sizing

| Complexity | PRD weight |
|---|---|
| Small bug/config/single behavior | Problem, solution, acceptance criteria. Skip filler. |
| Medium feature/integration | User stories, decisions, acceptance criteria, key interfaces/examples. |
| Large system/multi-team | Full template: definitions, interfaces, edge cases, rationale, risks. |

## Project-memory integration

If tracked work is active, follow `project-memory`. PRD supports `.ai/current-work.md`; it is not the anchor. Make constraints, decisions, rationale, rejected alternatives, and open questions easy to lift into current-work. Avoid exact file paths unless a prototype snippet is the clearest decision record.

## Template

Include only relevant sections. Skip sections that would be filler.

````md
---
title: [Concise title]
date_created: [YYYY-MM-DD]
status: Draft | Review | Approved | Deprecated
tags: [optional]
---

# [PRD title]

[1-3 sentences: what this defines, why it exists, who it is for.]

## Problem Statement
[User pain today; why it matters.]

## Solution
[User-visible change and target experience.]

## User Stories
1. As a [actor], I want [feature], so that [benefit]
2. ...

## Implementation Decisions
- **Constraints**: [must/must-not]
- **Architecture**: [module boundaries, patterns, schema/API contracts]
- **Clarifications**: [resolved ambiguities, chosen approaches]
- **Rationale**: [why key choices were made]

## Interfaces & Data Contracts *(if relevant)*
```typescript
// APIs, schemas, examples
```

## Examples & Edge Cases *(if relevant)*
**Example: [scenario]**
- Input: ...
- Expected: ...
- Why: ...

**Edge case: [scenario]**
- Input: ...
- Expected: ...
- Why: ...

## Testing Decisions
- What behavior must be tested
- Which modules/areas need tests
- Similar prior tests if known

## Acceptance Criteria
- Given [context], when [action], then [outcome]
- The system shall [behavior] when [condition]

## Out of Scope
- [Feature/behavior] — why excluded

## Risks & Assumptions
- [Risk/assumption] — impact if wrong

## Alternatives Considered *(if relevant)*
- [Alternative] — why not chosen

## Definitions *(if relevant)*
| Term | Meaning |
|---|---|
| ... | ... |

## Open Questions *(if any)*
- [Question] — why it matters

## References
[Related PRDs, ADRs, docs, issues, external refs]
````

## See also

- `to-issues` — break PRD into vertical slices.
- `project-memory` — tracked-work lifecycle and learning/archive rules.
