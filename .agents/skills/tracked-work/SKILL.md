---
name: tracked-work
description: Manage tracked feature work using `.ai/current-work.md` and related spec/plan/review artifacts. Use when workflow prompts start or continue tracked work, when the user wants resume-safe feature context across sessions, or when the agent needs conventions for `.ai/` feature artifacts, slugs, archive format, or promotion into project memory / ADRs.
---

# Tracked Work

Conventions for managing active feature work in `.ai/`.

`current-work.md` is the **feature context anchor**: the living record of what was decided, why, what was rejected, what remains open, and how to restart cleanly in a new session. During feature work, project memory is the stable foundation you read; `current-work.md` is where you capture new implementation context.

## Lifecycle rules
- If `.ai/current-work.md` exists and relates to the current task, continue from it.
- If it tracks a different unfinished feature, ask the user before replacing it.
- Keep exactly one active feature in `current-work.md` at a time.
- Read relevant project memory at feature start, but record new implementation findings in `current-work.md`, not in project memory.
- Update `current-work.md` at meaningful pause points: after major decisions, after resolving an open question, after discovering a constraint, and before ending a session.
- When the feature completes, run a promotion review to decide what should move into project memory or an ADR.
- After promotion review, archive the feature artifacts and final `current-work.md` snapshot, then leave `current-work.md` ready for the next feature.

## `current-work.md`
Keep it lightweight — not a transcript, not a project log. Prefer a compact working record, usually around 50-100 lines, with distilled reasoning instead of chronology.

Include only what helps future sessions resume with full context:
- Active feature (slug, title, status, dates)
- Objective / expected outcome
- Constraints and invariants to respect
- Key decisions and rationale
- Rejected alternatives and why they were rejected
- Current implementation state
- Current step / next restart step
- Evolving plan (short checklist)
- Relevant files
- Linked artifacts
- Open questions / blockers
- Assumptions to verify
- Parking lot
- Completion handoff
- Promotion candidates for project memory or ADRs

## Slug convention
Derive from the feature title: lowercase, hyphenated, concise (e.g. `auth-refresh-token`, `fix-build-race`).

## Feature artifacts
Named by slug alongside `current-work.md`:
- `.ai/<slug>-spec.md`
- `.ai/<slug>-plan.md`
- `.ai/<slug>-review.md`

Only create what the workflow actually needs — not all three every time.

## Promotion review

When a feature is done, review `current-work.md` and classify what should happen next:

### Promote to project memory
Use for facts that should influence future work across the repo:
- Conventions and workflow rules
- Canonical commands or paths
- Durable repo constraints
- Recurring pitfalls with verified fixes
- Long-lived user preferences

### Promote to ADR or decision doc
Use for decisions that should outlive the feature and be visible broadly:
- Cross-feature architectural choices
- Significant tradeoffs that will matter later
- Rejected alternatives worth remembering to avoid re-litigating them
- Decisions that affect multiple teams, systems, or future designs

### Keep only in the archived feature record
Use for details that matter for history but not for ongoing repo memory:
- Temporary implementation state
- One-off debugging notes
- Expired blockers
- Branch-local execution details

Always tell the user what was promoted, what was archived only, and where each artifact lives.

## Archive
Move completed feature artifacts to `.ai/archive/` with dated prefixes. Include the final `current-work.md` snapshot so the feature anchor survives closure.

Examples:
- `.ai/archive/YYYY-MM-DD-<slug>-current-work.md`
- `.ai/archive/YYYY-MM-DD-<slug>-spec.md`
- `.ai/archive/YYYY-MM-DD-<slug>-plan.md`
- `.ai/archive/YYYY-MM-DD-<slug>-review.md`

Leave `current-work.md` ready to be replaced by the next feature.
