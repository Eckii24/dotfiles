---
description: Rough idea → bounded grill/PRD/issues with tracked feature work (no implementation)
---

Creates tracked-work artifacts under `.ai/`.

## Setup

1. Read `.ai/current-work.md` if present.
2. Use compact `AGENTS.md` tracked-work rules; read `project-memory` only for create/replace/archive details or unclear lifecycle.
3. Current-work Todo Tracker = major phases only; detailed tasks stay in `.ai/<slug>-issues.md`.

## 1. Grill

- User rough idea: `$@`.
- Follow `~/.agents/skills/grill-me/SKILL.md`, but token-budget it: ask only blocking questions, max 5 per batch.
- If repo exploration can answer, inspect code instead of asking.
- Stop when major scope/constraints/expected behavior are clear enough; record non-blocking open questions instead of endless grilling.
- Capture resolved decisions as compact bullets for PRD.

## 2. PRD

- Delegate to `prd-writer` with decision bullets, original idea, current-work path, active slug, intended PRD path.
- Read PRD file + result.
- Ask one compact question batch for blocking gaps only. Non-blocking gaps stay in PRD `Open Questions`.
- Ask user to confirm. For small wording/scope fixes, edit PRD directly; re-delegate only for structural changes.
- Max 2 PRD revision cycles, then ask user to accept, defer questions, or continue.
- Refresh current-work: mark PRD phase complete, next restart step.

## 3. Issues breakdown

- Delegate to `issues-writer` with confirmed PRD summary/path + artifact paths.
- Read issues file + result.
- Ask one compact question batch for blocking gaps only.
- Ask user to confirm. For small fixes, edit issues directly; re-delegate only for structural breakdown changes.
- Max 2 issues revision cycles, then ask user to accept, defer questions, or continue.
- Refresh current-work: mark issues phase complete, keep Todo minimal.

## 4. Persist/complete

- Create/update current-work: slug, PRD path, issues path, current step, blockers, next restart step.
- Ask via `questionnaire`: complete/archive now or keep active for implementation.
- If archive: update live current-work first so closeout boxes are checked, then archive final current-work + active PRD/issues artifacts per `project-memory`.
- If active: leave closeout boxes unchecked and refresh next step.
- Summary: current-work, PRD path, issues path, archive state, open questions/next steps. Tell user they can continue with `/implement`, `/prd-issues-implement`, or `/prd-issues-implement-review` depending on whether they want implementation only or implementation plus one formal review pass.
