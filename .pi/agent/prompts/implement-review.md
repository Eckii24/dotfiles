---
description: Implement tracked feature work, then run one formal review pass with findings only
---

Assume tracked feature work and `.ai/` artifacts.

## Setup

1. Read `.ai/current-work.md` if present before delegating.
2. Use compact `AGENTS.md` tracked-work rules; read `~/.agents/skills/project-memory/SKILL.md` only for create/replace/archive details or unclear lifecycle.
3. You own the loop. `worker` implements/tests only; `code-reviewer` reviews only.
4. Current-work Todo Tracker = major phases only. Detailed tasks live in `.ai/<slug>-issues.md` when present.

## Workflow

1. `worker`: implement `$@`.
   - Pass current-work path when present.
   - Stop after implementation + needed eval/test runs.
   - No self-review beyond concrete blockers/uncertainties.
   - Require changed-file paths, artifact paths, eval/test results.
2. Build a compact review packet. Do not blindly forward full `{previous}` if long.
   - requirement summary: max 10 bullets / relevant acceptance criteria only
   - changed files and key touched symbols
   - eval/test summary
   - current-work/review artifact paths
   - explicit review signal: this workflow is `/implement-review`
3. Review once:
   - If low-risk non-code change, run inline checklist and record `Formal review skipped: low-risk non-code change`.
   - Else run one full `code-reviewer` pass with the compact packet.
4. Persist review evidence.
   - If there are meaningful findings, create/update `.ai/<slug>-review.md` as a cumulative ledger.
   - Preserve originals; append triage notes instead of deleting findings.
5. Stop after review.
   - Do not auto-fix review findings.
   - If the user wants fixes, that is a separate follow-up step.
6. Finish:
   - Update current-work: major Todo, changed files, review path, eval/test results, next step, assumptions/follow-ups.
   - Ask via `questionnaire` whether tracked work is complete/archive now.
   - If yes, first update live current-work closeout boxes, then archive final current-work + active PRD/issues/review artifacts per `project-memory`.

## Final summary requirements

Include: current-work path, changed files, review path, review mode used (formal or skipped), Blocking/Important findings, minor follow-ups, eval/test outcome, archive state, assumptions/follow-ups.
State explicitly: implementation complete, review complete, no fixes applied. If useful, tell user they can prompt again to implement the findings.
