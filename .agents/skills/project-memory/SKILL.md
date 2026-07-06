---
name: project-memory
description: Manage tracked feature work with `.ai/current-work.md`, learnings, AGENTS.md guidance, handoffs, and archive rules.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Use this skill for resumable feature work, handoffs, learning extraction, and archive decisions. Memory has 3 layers:

1. `.ai/current-work.md` = active feature anchor / restart state.
2. `.ai/learnings/*` and `~/.agents/learnings/*` = curated reusable lessons; pending first, approved injected as refs only.
3. `AGENTS.md` = tiny durable operating rules, not evidence storage.

Avoid generic parallel memory files (`.ai/project.md`, `.ai/conventions.md`, `.ai/pitfalls.md`, `.ai/README.md`, broad `.ai/decisions/`) unless user explicitly asks. Use ADR skill for real ADRs.

## When to track

Track when work spans sessions, creates PRD/stories/review artifacts, has costly context, or user asks for handoff/resume. Skip for quick questions/one-off edits.

If `.ai/current-work.md` already exists for another feature, ask before replacing it. Keep exactly one active top-level feature anchor and same slug across active artifacts.

Preferred naming:

```text
.ai/current-work.md
.ai/<slug>-prd.md
.ai/<slug>-stories.md
.ai/<slug>-review.md
.ai/learnings/pending/*.md
.ai/archive/
```

## Start / resume

1. Find root: `git rev-parse --show-toplevel 2>/dev/null || pwd`.
2. Read in order, only as needed:
   - `.ai/current-work.md`
   - active `.ai/<slug>-prd.md`, `.ai/<slug>-stories.md`, `.ai/<slug>-review.md`
   - injected approved learning refs; full learning files only when directly relevant
   - `AGENTS.md`
3. Validate memory claims against live code before relying on them.
4. Report briefly: files checked, active feature, 2-5 relevant takeaways, stale/conflicting info.

## `current-work.md` contract

Keep compact; working record, not transcript. Always include a minimal Todo Tracker when active. If a stories file exists, put detailed tasks there, not in `current-work.md`.

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
- [ ] Learn extraction run
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

## Learning candidates
- Summary: [one sentence]
  - Why it matters: [1-2 lines]
  - Evidence:
    - [exact path]
  - Candidate target: project learning | global learning | AGENTS.md | archive only
```

Rules:
- Todo = major phases only; no detailed checklist when `.ai/<slug>-stories.md` exists.
- Keep evidence sections bounded to ~3-5 terse, high-signal items.
- Preserve original review findings until learning extraction mined them; append fix/verification notes instead of deleting evidence.
- Keep `Next restart step` exact and current.
- Do not create approved learnings directly.

## During active work

Update `current-work.md` when state materially changes:
- major phase completion
- decisions / rejected options
- blockers / assumptions
- review findings and fixes
- reusable learning candidates with evidence paths
- artifact links and eval/test results

Prefer explicit learning candidates in `current-work.md`; then review artifacts, changed files, session context.

## Learning flow

Use `learn-orchestrator` for extraction when reusable evidence exists. Pending learnings are ok; approved changes and AGENTS.md promotion happen through `/skill:learn review`.

Candidate buckets:
- Keep in `current-work.md`: only needed for active restart.
- Promote to learning: reusable, needs context (`Why`, `When`, `Details`).
- Promote to `AGENTS.md`: stable short operating rule.
- Archive only: historical, not worth injecting.

Promote only compact durable essence to `AGENTS.md`.

## Archive / closeout

Archive completed or replaced tracked work only after explicit user confirmation.

Before moving files, update live `.ai/current-work.md` so final Todo Tracker marks:
- `User confirmed feature complete`
- `Active artifacts archived`

Then archive final snapshots with dated prefixes:

```text
.ai/archive/YYYY-MM-DD-<slug>-current-work.md
.ai/archive/YYYY-MM-DD-<slug>-prd.md
.ai/archive/YYYY-MM-DD-<slug>-stories.md
.ai/archive/YYYY-MM-DD-<slug>-review.md
```

Archive final `current-work.md` too, so feature can be reconstructed.

## Session-end check

Before finishing meaningful tracked work, verify:
- `current-work.md` is enough for cold restart.
- Todo Tracker is minimal and accurate.
- pitfalls/rejected options/review fixes/learning candidates are captured with evidence.
- reusable learning extraction was run or explicitly skipped because no candidate exists.
- no archive happened without user confirmation.

## Response snippets

```md
Memory checked: `.ai/current-work.md`, `.ai/<slug>-stories.md`
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
- `learn-orchestrator` — pending learnings created from current-work/review evidence
```
