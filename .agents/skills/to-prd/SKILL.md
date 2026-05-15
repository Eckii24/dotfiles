---
name: to-prd
description: 'Turn the current context into a Product Requirements Document. Use when user wants to create a PRD, define what to build, capture requirements, or produce a spec for a feature.'
---

# To PRD

Create a PRD for `${input:Feature}`.

Save the PRD to the output path provided in the task. If no explicit path is given, follow `project-memory` skill conventions.

## What makes a good PRD

A good PRD answers: what are we building, why, for whom, and how do we know it's done?

Write for an executor (AI agent or human) who has zero prior context. Be explicit, concrete, and self-contained:

- Use precise language. Avoid idioms, metaphors, or ambiguous phrasing.
- Define domain terms the first time you use them.
- Include examples and edge cases where behavior isn't obvious.
- Prefer structured formats (tables, lists, code blocks) over prose for parseable content.
- Capture rationale, tradeoffs, and unresolved questions in a form that can be copied into `.ai/current-work.md` without re-reading the whole conversation.

## Process

### 1. Synthesize, then clarify gaps

Start by drafting from what you already know — conversation context, codebase exploration, existing docs. Don't begin with a full interview.

If critical gaps remain after synthesis — ambiguous scope, conflicting constraints, missing acceptance criteria — ask a **short, targeted batch of questions** about only those gaps. Don't ask what you can answer from context or code.

### 2. Explore the codebase

If you haven't already, explore the repo to understand the current state. Respect existing conventions, domain language, and any ADRs in the area you're touching.

### 3. Write the PRD

Use the template below. Match the weight of the PRD to the complexity of the work (see sizing guidance).

## Sizing guidance

Match the PRD's weight to the work's complexity:

| Complexity | What the PRD looks like |
|---|---|
| **Small** (bugfix, config, single behavior) | Problem, solution, acceptance criteria. Skip interfaces, examples, risks unless non-obvious. |
| **Medium** (feature, integration) | Full PRD with user stories, implementation decisions, acceptance criteria. Include interfaces and examples when choices aren't obvious. |
| **Large** (system, architecture, multi-team) | Thorough PRD with all sections. Definitions, detailed interfaces, edge cases, and explicit rationale are essential. |

## Integration with `project-memory`

If tracked feature work is active, follow `project-memory` conventions for `.ai/current-work.md` structure and feature artifact paths.

Write the PRD so it supports the feature anchor without becoming the anchor itself:
- make constraints easy to lift into `.ai/current-work.md`
- state non-obvious decisions and rationale clearly
- separate rejected alternatives from still-open questions
- keep durable decisions easy to promote later into project memory or ADRs

## See also

- `to-issues` — break this PRD into independently-grabbable vertical slices
- `project-memory` — project memory, feature anchor, tracked work lifecycle, promotion review

## Template

Include only the sections relevant to the scope. Sections marked *(if relevant)* should be skipped when they'd just contain filler.

```md
---
title: [Concise title]
date_created: [YYYY-MM-DD]
status: Draft | Review | Approved | Deprecated
tags: [optional, e.g. feature, api, infrastructure, migration]
---

# [PRD title]

[1-3 sentences: what this PRD defines, why it exists, and who it's for.]

## Problem Statement

[The problem from the user's perspective. What pain exists today, and why does it matter?]

## Solution

[The solution from the user's perspective. What changes, and what does the experience look like after?]

## User Stories

[Numbered list of user stories. Scale the list to the feature's complexity — a small fix might have 2-3, a large feature should be extensive.]

1. As a [actor], I want [feature], so that [benefit]
2. ...

## Implementation Decisions

[The core decisions that shape how this gets built. Merge requirements, constraints, and architectural choices here. Include:]

- **Constraints**: what must or must not be true (technical, business, regulatory)
- **Architectural decisions**: module boundaries, patterns, schema changes, API contracts
- **Technical clarifications**: resolved ambiguities, chosen approaches

[Do NOT include specific file paths — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note it came from a prototype.]

## Interfaces & Data Contracts *(if relevant)*

[APIs, schemas, data flows, integration points. Use code blocks for schemas and examples.]

```typescript
// Example interface or schema
```

## Examples & Edge Cases *(if relevant)*

[Concrete examples showing expected behavior, especially where it isn't obvious from user stories.]

**Example: [scenario name]**
- Input: ...
- Expected: ...
- Why: ...

**Edge case: [scenario name]**
- Input: ...
- Expected: ...
- Why: ...

## Testing Decisions

[How this feature should be tested. Include:]

- What makes a good test for this feature (test external behavior, not implementation details)
- Which modules or areas need tests
- Prior art for similar tests in the codebase (if any)

## Acceptance Criteria

[How do we know this is done? Each criterion should be testable.]

- Given [context], when [action], then [expected outcome]
- The system shall [specific behavior] when [condition]
- ...

## Out of Scope

[What is explicitly NOT part of this work. Be specific — vague exclusions don't prevent scope creep.]

- [Feature/behavior] — why it's excluded
- ...

## Risks & Assumptions

- [Risk or assumption] — impact if wrong
- ...

## Alternatives Considered *(if relevant)*

[Include when a non-obvious choice was made.]

- [Alternative approach] — why not chosen
- ...

## Definitions *(if relevant)*

[Define domain terms, acronyms, or abbreviations that aren't obvious. Skip when all terms are standard.]

| Term | Meaning |
|------|---------|
| ... | ... |

## Open Questions *(if any)*

[Questions that surfaced during PRD creation but couldn't be resolved.]

- [Question] — why it matters
- ...

## References

[Links to related PRDs, ADRs, docs, external resources.]
```
