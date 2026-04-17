---
name: project-memory
description: Manage tracked feature work across sessions using `.ai/current-work.md`, learning promotion, and archive conventions. Use when the user asks to remember things, resume a feature, start tracked work, save a handoff, or when the agent needs the repo's tracked-work and learning-lifecycle rules.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

In this setup, **project memory is not a separate pile of repo-memory files**. It is the workflow that keeps three layers aligned:

1. **Working memory** — `.ai/current-work.md`
2. **Curated learnings** — `.ai/learnings/*.md` and `~/.agents/learnings/*.md`
3. **Durable operating guidance** — `AGENTS.md`

Use this skill to manage the lifecycle between those layers.

## Memory model

### 1) Working memory — `current-work.md`

Use `.ai/current-work.md` as the active feature anchor:
- current objective
- a **minimal** todo tracker with only major workflow phases
- constraints and decisions
- implementation state
- linked spec/plan/review artifacts
- next restart step
- open questions/blockers
- a bounded evidence log for pitfalls/surprises, failed or rejected attempts, review findings/fixes, and learning candidates with exact evidence paths

If a `.ai/<slug>-plan.md` exists, keep detailed execution tasks there. The todo tracker in `current-work.md` should stay intentionally minimal.

This is the **source of truth for in-progress work**.

### 2) Curated learnings — `.ai/learnings/`

Use learnings for reusable insights that should survive the current feature and still carry enough context to be useful later.

Typical fit:
- repeatable workflow lessons
- tool-usage lessons
- repo-specific traps that will recur
- durable user preferences with enough context to apply them correctly

Pending learnings live in `pending/`. Approved learnings are the only ones injected into context.

### 3) Durable guidance — `AGENTS.md`

Use `AGENTS.md` only for short, stable operating rules that should directly shape future agent behavior.

Typical fit:
- concise directives
- durable workflow rules
- high-signal preferences that no longer need supporting detail

Do **not** use `AGENTS.md` as a scratchpad or evidence store.

## What not to create

Do **not** introduce broad repo-memory files like these by default:
- `.ai/project.md`
- `.ai/conventions.md`
- `.ai/pitfalls.md`
- `.ai/README.md`
- `.ai/decisions/`

Those add parallel memory systems and drift.

If the repo already has such files, treat them as legacy context and prefer:
- `current-work.md` for active work
- learnings for reusable lessons
- `AGENTS.md` for compact durable rules

If a standalone architectural decision record is truly needed, use the ADR skill explicitly instead of creating a generic decisions tree by default.

## Default layout

Prefer this minimal repo-root `.ai/` layout:

```text
.ai/
  current-work.md
  <slug>-spec.md
  <slug>-plan.md
  <slug>-review.md
  learnings/
    *.md
    pending/
      *.md
  archive/
```

Only create the files a workflow actually needs.

## Start-of-session workflow

### 1) Find the project root

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

For monorepos, prefer the git root unless the package is clearly independent.

### 2) Read memory in this order

1. `.ai/current-work.md`
2. relevant active artifacts: `.ai/<slug>-spec.md`, `.ai/<slug>-plan.md`, `.ai/<slug>-review.md`
3. approved learning refs already injected into context
4. specific learning files only when a ref looks directly relevant
5. `AGENTS.md` as durable operating guidance

Re-check critical facts against live code before relying on memory-derived claims.

### 3) Surface what matters early

Early in your reply, briefly state:
- which memory/artifact files you checked
- whether a feature anchor is active
- the 2–5 most relevant takeaways
- any stale/conflicting information you noticed

## When to track work

Track a feature when:
- it spans multiple sessions
- losing context would be expensive
- the workflow will produce spec/plan/review artifacts
- the user explicitly wants resumable work
- the task is large enough that a restart step matters

For quick questions or one-off edits, skip tracked-work overhead.

## Creating or replacing `current-work.md`

Create `.ai/current-work.md` when starting a new tracked feature.

If one already exists for a different feature, ask the user before replacing it.

Keep exactly one active top-level feature anchor:
- `.ai/current-work.md`
- optional `.ai/<slug>-spec.md`
- optional `.ai/<slug>-plan.md`
- optional `.ai/<slug>-review.md`

All active top-level artifacts must share the same slug.

When switching to a new feature:
1. mark the old feature done
2. archive its active artifacts into `.ai/archive/`
3. start the new anchor cleanly

## `current-work.md` template

Keep it compact. Aim for a working record, not a transcript.

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
- [ ] [Major phase only]
- [ ] Learn extraction run
- [ ] User confirmed feature complete
- [ ] Active artifacts archived

## Decisions & rationale

- [Decision] — [why]
- [Rejected alternative] — [why rejected]

## Current state

[Done / in progress / next]

## Next restart step

[Exact next action]

## Open questions / blockers

- [Question] — [why it matters]

## Pitfalls & surprises

- [Short note] — Evidence: [exact path]

## Failed attempts / rejected options

- [Attempt or option] — [why it was rejected] — Evidence: [exact path]

## Review findings & fixes

- [Finding] — [fix or current status] — Evidence: [exact path]

## Learning candidates

- Summary: [one-sentence candidate learning]
  - Why it matters: [1-2 lines]
  - Evidence:
    - [exact path]
  - Candidate target: project learning | global learning | AGENTS.md | archive only
```

Rules for the todo tracker:
- Always include it when `current-work.md` is active.
- Keep it **minimal**: one checkbox per major workflow phase, not a task list.
- If a plan file exists, keep detailed steps in `.ai/<slug>-plan.md` instead of mirroring them here.
- Mark only completed major phases; let `Next restart step` carry the exact next action.
- Always end with the three checkboxes related to learning extraction, user confirmation of completion, and artifact archiving.

Add sections only when useful. Keep each evidence-log section bounded to roughly 3–5 terse items. Refresh, merge, or drop stale/resolved noise instead of appending a session transcript.

## Feature lifecycle

During active work:
- record new findings in `current-work.md`, especially pitfalls/surprises, failed attempts, review findings/fixes, and learning candidates
- keep the `Todo Tracker` populated with only the major workflow phases relevant to the active flow and the final steps of learning extraction, user confirmation, and artifact archiving
- keep evidence-log entries concise and backed by exact file/artifact paths
- link spec/plan/review artifacts explicitly
- keep the restart step fresh
- do **not** create approved learnings directly

When the work produces reusable lessons:
- prefer explicit `current-work.md` learning candidates first, then use review artifacts, changed files, and session context to validate or fill gaps
- run extraction through the `learn-orchestrator` sub-agent
- review them manually via `/skill:learn review`
- promote only the compact durable essence into `AGENTS.md`

## Promotion review

When a feature is done, classify each learning candidate into one of four buckets:

### A. Keep in `current-work.md`
Use when the work is still active or the note is only needed for the immediate restart.

### B. Promote to learnings
Use when the lesson is reusable and still benefits from structured context (`Why`, `When to Apply`, `When Not to Apply`, `Details`).

### C. Promote to `AGENTS.md`
Use when the lesson is stable enough to become a short operating rule.

### D. Archive only
Use when the note is historically useful but not worth injecting or promoting.

## Archive

Archive completed or replaced tracked-work artifacts under `.ai/archive/` with dated prefixes.

Only archive after the user explicitly confirms that the tracked work is complete.

Examples:
- `.ai/archive/YYYY-MM-DD-<slug>-current-work.md`
- `.ai/archive/YYYY-MM-DD-<slug>-spec.md`
- `.ai/archive/YYYY-MM-DD-<slug>-plan.md`
- `.ai/archive/YYYY-MM-DD-<slug>-review.md`

Include the final `current-work.md` snapshot so the feature can be reconstructed later.

## Session-end check

Before finishing meaningful work, ask:
- Is `current-work.md` up to date enough for a cold restart?
- Is the `Todo Tracker` still minimal, accurate, up-to-date and aligned with the active workflow?
- Did I capture fresh pitfalls, rejected options, review fixes, and learning candidates while the evidence is still easy to recover?
- Did this session produce a reusable learning?
- Did anything become durable enough for `AGENTS.md`?
- Has the user explicitly confirmed that anything should be archived now?

## Response patterns

When you read tracked work:

```md
Memory checked: `.ai/current-work.md`, `.ai/<slug>-plan.md`
Feature anchor active: auth-refresh-token (in progress)
Relevant: next restart step is updating `src/auth.ts`; review artifact already captured two follow-up fixes.
```

When you update the feature anchor:

```md
Feature anchor updated:
- `.ai/current-work.md` — refreshed the minimal Todo Tracker, captured decisions, refreshed bounded evidence-log sections, linked relevant artifacts, and updated the next restart step
```

When you close and archive work:

```md
Tracked work updated:
- `.ai/archive/2026-03-31-auth-refresh-token-current-work.md` — archived final feature anchor
- `.ai/archive/2026-03-31-auth-refresh-token-review.md` — archived review snapshot
- `learn-orchestrator` — created pending learnings from explicit current-work candidates and review evidence
- `/skill:learn review` — curated pending learnings for approval/promotion
```
