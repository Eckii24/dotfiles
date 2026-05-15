---
name: to-issues
description: 'Break a PRD, spec, or plan into independently-grabbable vertical slices. Use when user wants to break down work into implementation slices, create a task breakdown, or convert a PRD into actionable issues.'
---

# To Issues

Break work into independently-grabbable vertical slices (tracer bullets) for `${input:Source}`.

Save the issues document to the output path provided in the task. If no explicit path is given, follow `project-memory` skill conventions.

## What makes a good breakdown

A good breakdown lets an agent or human grab any slice and execute it independently. The best breakdowns are:

- **Vertical**: each slice cuts through ALL relevant layers end-to-end — not a horizontal slice of one layer.
- **Demoable**: a completed slice is verifiable on its own.
- **Right-sized**: prefer many thin slices over few thick ones.
- **Honest about dependencies**: make blocking relationships explicit instead of leaving them implicit.

## Process

### 1. Gather context

Work from whatever is already available — a PRD, spec, plan, conversation context, or a combination. If the user points to a specific document, read it fully before proceeding.

### 2. Explore the codebase (if needed)

If you haven't already explored the repo, do so to understand the current state. Respect existing conventions, domain language, and any ADRs in the area you're touching.

### 3. Draft vertical slices

Break the work into **tracer bullet** slices. Each slice is a thin vertical cut through all relevant layers, NOT a horizontal slice of one layer.

Classify each slice:

- **AFK** — can be implemented and verified without human interaction. Prefer AFK slices.
- **HITL** — requires human judgment: architectural decisions, design review, manual testing, external access.

Describe affected areas and modules, not exact file paths — they go stale fast.

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Type**: HITL / AFK
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Write the issues document

For each approved slice, write an issue using the template below. Order by dependency (blockers first).

## Sizing guidance

Match the breakdown's granularity to the work's complexity:

| Complexity | What the breakdown looks like |
|---|---|
| **Small** (bugfix, config, single behavior) | 1-2 slices. Might be a single AFK issue. Skip the quiz if trivial. |
| **Medium** (feature touching multiple areas) | 3-6 slices. Quiz the user on granularity. |
| **Large** (system, architecture, multi-phase) | 6+ slices with explicit dependency chains. Quiz is essential. |

## Integration with `project-memory`

If tracked feature work is active, follow `project-memory` conventions for `.ai/current-work.md` structure and artifact paths.

The issues document is for **execution structure** — not the running context record. Record learnings, major decisions, and restart state in `.ai/current-work.md` following `project-memory` conventions.

## See also

- `to-prd` — create the PRD that feeds into this breakdown
- `project-memory` — project memory, feature anchor, tracked work lifecycle, promotion review

## Template

```md
---
source: [Link or path to the PRD, spec, or plan this breaks down]
date_created: [YYYY-MM-DD]
status: Draft | Approved | In Progress | Completed
tags: [optional]
---

# [Breakdown title]

[1-2 sentences: what work this breaks down and the total scope.]

## Slices

### Slice 1 — [Title]

**Type**: AFK | HITL
**Blocked by**: None — can start immediately | Slice N

#### What to build

[Concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation. Name affected modules and areas, not exact file paths.]

[Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note it came from a prototype.]

#### Acceptance Criteria

- [ ] [Criterion 1 — testable, concrete]
- [ ] [Criterion 2]
- [ ] ...

---

### Slice 2 — [Title]

[Same structure. Add more slices as needed.]

---

## Dependency Graph *(if relevant)*

[Skip for simple breakdowns. For complex work with multiple dependency chains, a visual summary helps.]

```
Slice 1 (AFK) ─┐
                ├─► Slice 3 (AFK) ─► Slice 5 (AFK)
Slice 2 (AFK) ─┘
Slice 4 (HITL) ──────────────────► Slice 6 (AFK)
```

## Open Questions *(if any)*

[Questions that surfaced during breakdown but couldn't be resolved.]

- [Question] — why it matters for the breakdown
- ...

## References

[Links to source PRD, related docs, ADRs.]
```
