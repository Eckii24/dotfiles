---
description: Story → bounded issues breakdown with tracked feature work (no implementation)
---

Creates tracked-work artifacts under `.ai/`.

## Setup

1. Read `.ai/current-work.md` if present.
2. Use compact `AGENTS.md` tracked-work rules; read `project-memory` only for create/replace/archive details or unclear lifecycle.
3. Current-work Todo Tracker = major phases only; detailed tasks stay in `.ai/<slug>-issues.md`.

## 1. Retrieve story

Resolve `$@`:
- Prefer dedicated story tool if available; else Azure DevOps via `az` CLI.
- For ADO URL, extract numeric work item ID.
- If org/project missing or retrieval fails, use `questionnaire`.
- If local path, read directly.
- Gather title, description, acceptance criteria, linked context/subtasks when available.
- Summarize story into max 10 requirement bullets for downstream agents; keep source path/ID for lookup.

## 2. Issues breakdown

- Delegate to `issues-writer` with story summary/source, current-work path, intended issues path.
- Read issues file + result.
- Ask one compact question batch for blocking gaps only. Non-blocking gaps go into `Open Questions`.
- Ask user to confirm. For small wording/scope fixes, edit issues doc directly; re-delegate only for structural breakdown changes.
- Max 2 writer revision cycles, then stop and ask user to choose: accept, defer questions, or continue.
- Refresh current-work: mark issues phase complete, keep Todo minimal.

## 3. Persist/complete

- Create/update current-work: story source, slug, issues path, current step, blockers, next restart step.
- Ask via `questionnaire`: complete/archive now or keep active for implementation.
- If archive: update live current-work first so closeout boxes are checked, then archive final current-work + active issues artifact per `project-memory`.
- If active: leave closeout boxes unchecked and refresh next step.
- Summary: current-work, story source, issues path, archive state, open questions/next steps. Tell user they can continue with `/implement`, `/issues-implement`, or `/issues-implement-review` depending on whether they want implementation only or implementation plus one formal review pass.
