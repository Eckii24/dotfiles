---
description: Implement → bounded review → focused fix for tracked feature work
---

Assume tracked feature work and `.ai/` artifacts.

## Setup

1. Read `.ai/current-work.md` if present before delegating.
2. Use compact `AGENTS.md` tracked-work rules; read `~/.agents/skills/project-memory/SKILL.md` only for create/replace/archive details or unclear lifecycle.
3. You own the loop. `worker` implements/tests only; `code-reviewer` reviews only.
4. Current-work Todo Tracker = major phases only. Detailed tasks live in `.ai/<slug>-issues.md` when present.

## Review budget

- Default path: 1 implementation pass + 1 review pass + at most 1 focused fix/verification pass.
- Hard cap: 2 focused fix/verification cycles. After that, stop and ask `questionnaire`: accept, defer remaining findings, or continue with explicit guidance.
- Use full `code-reviewer` only once. Later passes are **verification-only**: check listed fixes and nearby regressions, not the whole change again.
- For trivial docs/prompt/config-only changes with no behavior/security/data risk, skip `code-reviewer`; run inline checklist and record `Formal review skipped: low-risk non-code change`.

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
3. Review:
   - If low-risk non-code change, run inline checklist and skip subagent.
   - Else run `code-reviewer` full review using the compact packet. Provide paths for deeper reads, not pasted full files/logs.
4. If Blocking/Important issues:
   - Create/update `.ai/<slug>-review.md` cumulative ledger; preserve originals, append fix/verification notes.
   - Mirror only durable high-signal fixes into current-work.
   - Run focused `worker` fix pass with only unresolved latest Blocking/Important findings, file:line refs, changed files, eval context. Do not pass full ledger unless needed.
   - Run `code-reviewer` in **verification-only mode** on those findings. Require output of only remaining Blocking/Important issues + eval status.
   - Do not loop for Minor suggestions.
5. Minor Issues / Suggestions:
   - Apply only if obvious, low-risk, in scope, and does not require another review.
   - Else record as follow-up.
6. Learning:
   - Run `learn-orchestrator` only with reusable evidence: explicit candidates, non-trivial review fixes, repeated pitfalls, durable workflow/tooling lesson, or user request.
   - If none, skip and record `Learning extraction skipped: no reusable learning candidate` in current-work when active.
   - Handle collisions with `questionnaire` + learning runtime, or record `/skill:learn review` follow-up.
7. Finish:
   - Update current-work: major Todo, changed files, review path, eval/test results, next step, assumptions/follow-ups.
   - Ask via `questionnaire` whether tracked work is complete/archive now.
   - If yes, first update live current-work closeout boxes, then archive final current-work + active PRD/issues/review artifacts per `project-memory`.

## Stop conditions

- no Blocking/Important issues after initial review or verification
- user accepts/defers remaining issues
- hard cap reached
- blocker/ambiguity needs `questionnaire`
