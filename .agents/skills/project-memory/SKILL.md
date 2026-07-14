---
name: project-memory
description: Manage tracked feature work with `.ai/current-work.md`, AGENTS.md guidance, handoffs, and archive rules.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Use this skill for resumable feature work, handoffs, and archive decisions. Memory has 2 layers:

1. `.ai/current-work.md` = active feature anchor / restart state.
2. `AGENTS.md` = tiny durable operating rules, not evidence storage.

Avoid generic parallel memory files (`.ai/project.md`, `.ai/conventions.md`, `.ai/pitfalls.md`, `.ai/README.md`, broad `.ai/decisions/`) unless user explicitly asks. Use ADR skill for real ADRs.

## When to track

Track when work spans sessions, creates wayfinder/spec/plan/review artifacts, has costly context, or user asks for handoff/resume. Skip for quick questions/one-off edits.

If `.ai/current-work.md` already exists for another feature, ask before replacing it. Keep exactly one active top-level feature anchor and same slug across active artifacts.

Preferred naming:

```text
.ai/current-work.md
.ai/<slug>-wayfinder.md
.ai/<slug>-spec.md
.ai/<slug>-plan.md
.ai/<slug>-review.md
.ai/archive/
```

## Start / resume

1. Find root: `git rev-parse --show-toplevel 2>/dev/null || pwd`.
2. Read in order, only as needed:
   - `.ai/current-work.md`
   - active `.ai/<slug>-wayfinder.md`, `.ai/<slug>-spec.md`, `.ai/<slug>-plan.md`, `.ai/<slug>-review.md`
   - `AGENTS.md`
3. Validate memory claims against live code before relying on them.
4. Report briefly: files checked, active feature, 2-5 relevant takeaways, stale/conflicting info.

## `current-work.md` contract

Keep compact; working record, not transcript. Always include a minimal Todo Tracker when active. If an implementation plan exists, put detailed steps there, not in `current-work.md`.

Template:

```md
# [Feature title]

- **Slug**: <slug>
- **Status**: In progress | Done | Idle
- **Started**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD

## Objective
[1-3 sentences]

## Todo Tracker
- [ ] [Major phase only]
- [ ] User confirmed feature complete
- [ ] Active artifacts archived

## Decisions & rationale
- [Decision] — [why]
- [Rejected option] — [why rejected]

## Current state
[Done / in progress / next]

## Next restart step
[Exact next action]

## Open questions / blockers
- [Question] — [why it matters]

## Pitfalls & surprises
- [Short note] — Evidence: [exact path]

## Failed attempts / rejected options
- [Attempt] — [why rejected] — Evidence: [exact path]

## Review findings & fixes
- [Finding] — [fix/status] — Evidence: [exact path]

```

Rules:
- Todo = major phases only; no detailed checklist when `.ai/<slug>-plan.md` exists.
- Keep evidence sections bounded to ~3-5 terse, high-signal items.
- Preserve original review findings; append fix/verification notes instead of deleting evidence.
- Keep `Next restart step` exact and current.

## During active work

Update `current-work.md` when state materially changes:
- major phase completion
- decisions / rejected options
- blockers / assumptions
- review findings and fixes
- artifact links and eval/test results

Keep reusable evidence in the active artifact. Promote only compact, durable operating rules to `AGENTS.md` after explicit review; do not invent a separate learning pipeline.

## Archive / closeout

Archive completed or replaced tracked work only after explicit user confirmation.

Before moving files, update live `.ai/current-work.md` so final Todo Tracker marks:
- `User confirmed feature complete`
- `Active artifacts archived`

Then archive final snapshots with dated prefixes:

```text
.ai/archive/YYYY-MM-DD-<slug>-current-work.md
.ai/archive/YYYY-MM-DD-<slug>-wayfinder.md
.ai/archive/YYYY-MM-DD-<slug>-spec.md
.ai/archive/YYYY-MM-DD-<slug>-plan.md
.ai/archive/YYYY-MM-DD-<slug>-review.md
```

Archive final `current-work.md` too, so feature can be reconstructed.

## Session-end check

Before finishing meaningful tracked work, verify:
- `current-work.md` is enough for cold restart.
- Todo Tracker is minimal and accurate.
- pitfalls/rejected options/review fixes are captured with evidence.
- no archive happened without user confirmation.

## Response snippets

```md
Memory checked: `.ai/current-work.md`, `.ai/<slug>-plan.md`
Feature anchor active: <slug> (in progress)
Relevant: next restart step is ...; review artifact has ...
```

```md
Feature anchor updated:
- `.ai/current-work.md` — refreshed minimal Todo Tracker, decisions/evidence, artifact links, next restart step
```

```md
Tracked work archived:
- `.ai/archive/YYYY-MM-DD-<slug>-current-work.md`
- `.ai/archive/YYYY-MM-DD-<slug>-review.md`
```
