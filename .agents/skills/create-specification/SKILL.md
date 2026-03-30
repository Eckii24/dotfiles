---
name: create-specification
description: 'Create a new specification file for the solution, optimized for Generative AI consumption.'
---

# Create Specification

Create a specification for `${input:SpecPurpose}`.

Save the spec to the output path provided in the task. If no explicit path is given, follow `tracked-work` skill conventions.

## What makes a good spec

A good spec answers: what are we building, why, for whom, and how do we know it's done?

Write for an executor (AI agent or human) who has zero prior context. Be explicit, concrete, and self-contained:

- Use precise language. Avoid idioms, metaphors, or ambiguous phrasing.
- Distinguish requirements (must), constraints (cannot/must not), and guidelines (should/prefer).
- Define domain terms the first time you use them.
- Include examples and edge cases where behavior isn't obvious.
- Prefer structured formats (tables, lists, code blocks) over prose for parseable content.

## Before writing: interview or clarify

If the input is a rough idea rather than a clear brief, **ask clarifying questions first**. Focus on:

- What problem does this solve, and for whom?
- What is explicitly in scope and out of scope?
- What constraints are real (technical, business, regulatory)?
- What does "done" look like — what are the acceptance criteria?
- What tradeoffs are intentional vs. unresolved?

A short, high-signal question set is better than a spec built on assumptions. When you have enough clarity, write the spec.

## Sizing guidance

Match the spec's weight to the work's complexity:

| Complexity | What the spec looks like |
|---|---|
| **Small** (bugfix, config, single behavior) | Purpose, requirements, acceptance criteria. Skip interfaces, dependencies, and rationale unless non-obvious. |
| **Medium** (feature, integration) | Full spec with interfaces, acceptance criteria, examples. Include dependencies and rationale when choices aren't obvious. |
| **Large** (system, architecture, multi-team) | Thorough spec with all sections. Definitions, detailed interfaces, edge cases, and explicit rationale are essential. |

## Template

Include only the sections relevant to the scope. Sections marked *(if relevant)* should be skipped when they'd just contain filler.

```md
---
title: [Concise title]
date_created: [YYYY-MM-DD]
status: Draft | Review | Approved | Deprecated
tags: [optional, e.g. feature, api, infrastructure, migration]
---

# [Spec title]

[1-3 sentences: what this spec defines, why it exists, and who it's for.]

## Definitions *(if relevant)*

[Define domain terms, acronyms, or abbreviations that aren't obvious. Skip for specs where all terms are standard.]

| Term | Meaning |
|------|---------|
| ... | ... |

## Requirements & Constraints

[The core of the spec. List what must be true, what must not happen, and what is preferred.]

- **Must**: [Requirement — concrete, testable]
- **Must not**: [Constraint — what is explicitly forbidden or out of scope]
- **Should**: [Guideline — preferred but flexible]
- ...

## Interfaces & Data Contracts *(if relevant)*

[APIs, schemas, data flows, integration points. Use code blocks for schemas and examples.]

```typescript
// Example interface or schema
```

## Acceptance Criteria

[How do we know this is done? Each criterion should be testable.]

- Given [context], when [action], then [expected outcome]
- The system shall [specific behavior] when [condition]
- ...

## Examples & Edge Cases *(if relevant)*

[Concrete examples showing expected behavior, especially for non-obvious cases.]

**Example: [scenario name]**
- Input: ...
- Expected: ...
- Why: ...

**Edge case: [scenario name]**
- Input: ...
- Expected: ...
- Why: ...

## Dependencies *(if relevant)*

[External systems, services, or other work this spec depends on. Focus on what is needed, not specific packages.]

- [System/service] — what capability is required and why
- ...

## Rationale & Context *(if relevant)*

[Why these requirements exist. What alternatives were considered. What tradeoffs were made. Include when the reasoning isn't obvious from the requirements alone.]

## Open Questions *(if any)*

[Questions that surfaced during spec writing but couldn't be resolved.]

- Question — why it matters
- ...

## References

[Links to related specs, ADRs, docs, external resources.]
```
