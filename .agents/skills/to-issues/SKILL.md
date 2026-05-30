---
name: to-issues
description: 'Break a PRD, spec, or plan into independently-grabbable vertical slices. Use when user wants to break down work into implementation slices, create a task breakdown, or convert a PRD into actionable issues.'
---

# To Issues

Break `${input:Source}` into independently-grabbable vertical slices (tracer bullets). Save to task-provided output path; if missing, follow `project-memory`.

## Good breakdown

- **Vertical**: each slice cuts through all relevant layers end-to-end; avoid horizontal layer-only tasks.
- **Demoable**: completed slice is independently verifiable.
- **Right-sized**: prefer thin slices over large blobs.
- **Dependency-honest**: blockers explicit.

## Process

1. Read source PRD/spec/story fully when provided.
2. Explore repo only as needed to understand current state, conventions, domain language, and ADRs.
3. Draft tracer-bullet slices. Classify:
   - **AFK**: implementable/verifiable without human interaction; prefer this.
   - **HITL**: needs human judgment, access, design review, manual test, or external decision.
4. For non-trivial work, quiz user on granularity, dependencies, merge/split, HITL/AFK. Skip quiz for trivial 1-slice work.
5. Write approved issues ordered by dependency.

Avoid exact file paths in issue bodies unless necessary; they go stale. Name modules/areas instead.

## Sizing

| Complexity | Breakdown |
|---|---|
| Small bug/config/single behavior | 1-2 slices; may skip quiz. |
| Medium multi-area feature | 3-6 slices; quiz granularity. |
| Large system/architecture | 6+ slices with dependency graph; quiz essential. |

## Project-memory integration

Issues doc = execution structure. `.ai/current-work.md` = running context, learnings, major decisions, restart state. Keep detailed tasks in issues file, not current-work.

## Template

````md
---
source: [Link/path]
date_created: [YYYY-MM-DD]
status: Draft | Approved | In Progress | Completed
tags: [optional]
---

# [Breakdown title]

[1-2 sentences: what this breaks down and total scope.]

## Slices

### Slice 1 — [Title]

**Type**: AFK | HITL
**Blocked by**: None | Slice N

#### What to build
[Concise vertical-slice behavior. Name affected modules/areas, not stale paths. Inline prototype snippet only when it captures a decision better than prose.]

#### Acceptance Criteria
- [ ] [Concrete testable criterion]
- [ ] ...

---

### Slice 2 — [Title]
[Same structure.]

## Dependency Graph *(if useful)*

```text
Slice 1 (AFK) ─┐
                ├─► Slice 3 (AFK)
Slice 2 (AFK) ─┘
Slice 4 (HITL) ─► Slice 5 (AFK)
```

## Open Questions *(if any)*
- [Question] — why it matters

## References
[Source PRD, docs, ADRs, related issues]
````

## See also

- `to-prd` — create source PRD.
- `project-memory` — tracked-work lifecycle and learning/archive rules.
