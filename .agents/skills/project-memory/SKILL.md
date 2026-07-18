---
name: project-memory
description: Manage tracked feature work with `.ai/current-work.md`, handoffs, and archive rules.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Use only for resumable feature work, handoffs, or explicit tracked artifacts.

## Purpose and scope

`.ai/current-work.md` is an active **restart pointer**, not a transcript, plan, or evidence warehouse. Keep exactly one active top-level anchor. Linked artifacts hold detail:

```text
.ai/current-work.md
.ai/<slug>-wayfinder.md
.ai/<slug>-spec.md
.ai/<slug>-plan.md
.ai/<slug>-review.md
.ai/archive/
```

Track only when work spans sessions, has expensive restart/handoff cost, creates durable artifacts, or user asks. Never replace an anchor for another feature without user confirmation.

## Start / resume

1. Find root: `git rev-parse --show-toplevel 2>/dev/null || pwd`.
2. Read `current-work.md` once, then only the linked artifact section needed for the active phase.
3. Validate memory claims against live code/eval before relying on them.
4. Report: active feature, active phase, 2-5 takeaways, and any stale/conflicting state.

Do not reread or update the anchor for routine worker completion.

## Anchor contract

Keep under **500 tokens** when possible. Shorter is better when restart state remains complete.

```md
# [Feature title]

- **Slug**: <slug>
- **Status**: In progress | Blocked | Done | Idle
- **Updated**: YYYY-MM-DD

## Objective
[1-3 sentences]

## Active artifacts
- `<path>` — purpose

## Major phases
- [ ] [phase + acceptance evidence]
- [ ] User confirmed feature complete
- [ ] Active artifacts archived

## Key decisions
- [Decision] — rationale — Evidence: `<path>`

## Current state
[Active phase, verified result, or blocker]

## Next restart step
[One exact action]

## Open blockers
- [Blocker] — decision needed
```

Rules:
- Major phases only. Detailed task lists belong in plan.
- Keep at most 3-5 high-signal decisions/blockers.
- Use exact paths; do not copy logs, code, full review findings, or failed-attempt history.
- Preserve review evidence in review artifact; anchor only links/status.

## Update policy

Update only at a material phase boundary, verified decision, blocker, handoff, or explicit closeout. Batch child results into one verified state packet. The packet supplies: phase, artifacts, acceptance/eval evidence when available, decision/blocker, current state, exact next action, and orchestration budget used when delegated work occurred.

If evidence is unavailable because work blocked before its gate, record that fact. Otherwise, if the packet is incomplete, return a blocker. Do not infer facts.

## Archive / closeout

Archive only after explicit user confirmation. Mark confirmation and archive state, then archive dated snapshots under `.ai/archive/`.

## Session-end check

Verify anchor supports a cold restart without carrying a transcript: objective, active phase, artifact paths, verified current state, blocker, and exact next step.
