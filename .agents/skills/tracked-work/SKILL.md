---
name: tracked-work
description: Manage tracked feature work using .ai/current-work.md and related spec/plan/review artifacts. Use when workflow prompts start or continue tracked work, or when the agent needs conventions for .ai/ feature artifacts, slugs, archive format, or current-work structure.
---

# Tracked Work

Conventions for managing active feature work in `.ai/`.

## Lifecycle rules
- If `.ai/current-work.md` exists and relates to the current task, continue from it.
- If it tracks a different unfinished feature, ask the user before replacing it.
- Keep exactly one active feature in `current-work.md` at a time.
- When the feature completes, archive artifacts and leave `current-work.md` ready for the next feature.

## `current-work.md`
Operational state for exactly one active feature. Keep it lightweight — not a project log. Include only what helps resume:
- Active feature (slug, title, status, dates)
- Objective
- Current step
- Evolving plan (short checklist)
- Relevant files
- Linked artifacts
- Open questions / blockers
- Parking lot
- Assumptions
- Completion handoff

## Slug convention
Derive from the feature title: lowercase, hyphenated, concise (e.g. `auth-refresh-token`, `fix-build-race`).

## Feature artifacts
Named by slug alongside `current-work.md`:
- `.ai/<slug>-spec.md`
- `.ai/<slug>-plan.md`
- `.ai/<slug>-review.md`

Only create what the workflow actually needs — not all three every time.

## Archive
Move completed feature artifacts to `.ai/archive/` with dated prefixes:
- `.ai/archive/YYYY-MM-DD-<description>.md`

Leave `current-work.md` ready to be replaced by the next feature.
