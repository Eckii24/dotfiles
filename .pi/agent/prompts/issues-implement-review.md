---
description: Story → issues → implement → bounded review/fix for tracked feature work
---

Creates tracked-work artifacts under `.ai/`.

## Setup

1. Read `.ai/current-work.md` if present.
2. Use compact `AGENTS.md` tracked-work rules; read `project-memory` only for create/replace/archive details or unclear lifecycle.
3. You own issues -> implement -> review -> repair. `worker` implements/tests only; `code-reviewer` reviews only.
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

## 3. Implement/review/repair

Review budget:
- Default: 1 implementation + 1 full review + at most 1 focused fix/verification.
- Hard cap: 2 focused fix/verification cycles, then `questionnaire` triage.
- Full `code-reviewer` only once; later passes are verification-only.
- Low-risk docs/prompt/config-only changes may skip formal reviewer with inline checklist.

1. `worker`: implement against requirement summary + confirmed issues + current-work.
   - Stop after implementation + needed eval/test runs.
   - No self-review beyond blockers/uncertainties.
   - Require changed files, artifacts, eval/test results.
2. Build compact review packet: requirement summary, relevant issues/acceptance criteria, changed files, key symbols, eval summary, artifact paths. Avoid forwarding long worker output.
3. Review:
   - If low-risk non-code change, run inline checklist and record skip reason.
   - Else run one full `code-reviewer` pass with compact packet.
4. If Blocking/Important issues:
   - Create/update `.ai/<slug>-review.md` ledger; preserve originals, append fix/verification notes.
   - Mirror only durable high-signal fixes into current-work.
   - Focused `worker` fix with only unresolved latest Blocking/Important findings + file:line refs.
   - `code-reviewer` verification-only on those findings; output only remaining Blocking/Important + eval status.
   - Do not loop for Minor suggestions.
5. Minor suggestions: apply only if obvious/low-risk/in-scope and no extra review needed; else record.
6. Refresh current-work after major phase changes.

## 4. Learning

- Run `learn-orchestrator` only when reusable evidence exists: explicit candidates, non-trivial review fixes, repeated pitfalls, durable workflow/tooling lesson, or user request.
- If none, skip and record `Learning extraction skipped: no reusable learning candidate` in current-work when active.
- If run, pass current-work, review artifact, changed files, explicit session transcript if available.
- Handle collisions with `questionnaire` + learning runtime, or record `/skill:learn review` follow-up.

## 5. Completion

Ask via `questionnaire` whether tracked work is complete/archive now.

If yes: update live current-work first so closeout boxes are checked, then archive final current-work + active issues/review artifacts per `project-memory`.

If no: keep anchor active, leave closeout boxes unchecked, refresh next restart step.

Final summary: current-work, story source, issues path, review path, changed files, final review outcome/accepted exceptions, learning result/skip, archive state, assumptions/follow-ups.
