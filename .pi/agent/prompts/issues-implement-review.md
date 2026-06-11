---
description: Story → issues → implement → one formal review pass with findings only
---

Creates tracked-work artifacts under `.ai/`.

## Setup

1. Read `.ai/current-work.md` if present.
2. Use compact `AGENTS.md` tracked-work rules; read `project-memory` only for create/replace/archive details or unclear lifecycle.
3. You own issues -> implement -> review. `issues-writer` decomposes only. `worker` implements/tests only; `code-reviewer` reviews only.
4. Current-work Todo Tracker = major phases only; detailed execution tasks stay in `.ai/<slug>-issues.md`.

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

## 3. Implement/review

1. `worker`: implement against requirement summary + confirmed issues + current-work.
   - Stop after implementation + needed eval/test runs.
   - No self-review beyond blockers/uncertainties.
   - Require changed files, artifacts, eval/test results.
2. Build compact review packet: requirement summary, relevant issues/acceptance criteria, changed files, key symbols, eval summary, artifact paths. Avoid forwarding long worker output.
   - Explicit review signal: this workflow is `/issues-implement-review`.
3. Review once:
   - If low-risk non-code change, run inline checklist and record skip reason.
   - Else run one full `code-reviewer` pass with the compact packet.
4. Persist review evidence.
   - If there are meaningful findings, create/update `.ai/<slug>-review.md` ledger.
   - Preserve originals; append triage notes instead of deleting findings.
5. Stop after review.
   - Do not auto-fix review findings.
   - If the user wants fixes, that is a separate follow-up step.

## 4. Completion

Ask via `questionnaire` whether tracked work is complete/archive now.

If yes: update live current-work first so closeout boxes are checked, then archive final current-work + active issues/review artifacts per `project-memory`.

If no: keep anchor active, leave closeout boxes unchecked, refresh next restart step.

Final summary: current-work, story source, issues path, review path, changed files, review mode used (formal or skipped), Blocking/Important findings, minor follow-ups, eval/test outcome, archive state, assumptions/follow-ups. State explicitly that no fixes were applied after review.
