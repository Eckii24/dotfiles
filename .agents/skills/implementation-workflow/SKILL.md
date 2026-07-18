---
name: implementation-workflow
description: Implement a bounded code change from a request, spec, or implementation plan. Use when executing implementation work and choosing between quick, bounded, and tracked modes.
---

# Implementation Workflow

Use for code delivery. Optimize for evidence and signal density, not ceremony.

## Mode choice

| Mode | Use when | Default shape |
|---|---|---|
| Quick Task | Small/local, obvious scope | Direct work; no artifacts/subagents |
| Bounded Delivery | Clear change across ~1-3 areas | Direct, or `0-1 scout -> 1 worker -> optional review` |
| Tracked Project | Multi-session, expensive restart/handoff, or explicitly requested | Phase contracts + `.ai/current-work.md` pointer |

Default Quick/Bounded. Do not inherit a stale/completed/unrelated anchor.

## Compact inputs

Before work, collect only: objective, acceptance criteria, exact paths/symbols, constraints/non-goals, and test commands. Extract this once into a handoff packet. Do not make every child reread full plan/spec/current-work files.

Use a scout only to answer a real uncertainty. Good output: exact paths, symbols, line ranges, tests, and one start point. Bad output: file dumps or generic architecture prose.

## Delivery shape

Give one worker a coherent vertical slice with owned acceptance tests. A plan bullet, file, type error, or local repair is not automatically another delegation.

The worker should implement, run relevant evals, and fix in-scope implementation/type/test failures before returning. It returns: status, changed paths, eval evidence, one decision/blocker, and one next action.

Parallelize only read-only or isolated work. Never share a mutable checkout between concurrent workers unless the caller explicitly provides safe isolation.

## Gates, budgets, review

For each phase state: objective, acceptance evidence, child shape, and escalation condition.

- Default phase budget: `0-1 scout -> 1 worker -> optional 1 reviewer`.
- More than three child runs in a phase needs an explicit evidence-based reason.
- Global orchestration budget: 12 delegation calls or 60 minutes wall time per run, whichever comes first. Count scouts, workers, reviewers, follow-ups, and state updates.
- At the global limit, collect any useful in-flight result, create a compact phase handoff, then stop before another delegation. Explicit user continuation starts a new budget.
- After two repair handoffs for the same slice, stop. Synthesize root cause and revise the plan/spec or surface a blocker.
- A live/evidence gate gets one diagnosis, one explicit decision, then one rerun. Do not create an artifact-edit chain around the gate.
- Do not advance until previous phase acceptance evidence exists.
- Formal review runs only when the user requests it or the chosen entrypoint includes it. For elevated risk, recommend review; do not auto-run or auto-fix it.

## Tracked-project integration

`current-work.md` is a restart pointer, not a transcript. Keep it under 500 tokens when possible and point to detail.

Update it only at material phase boundary, blocker, decision, handoff, or closeout. Do not update/read it after routine child completions. Keep Todo Tracker at major-phase granularity; detailed work stays in the plan.

At a phase handoff, record only: completed phase and acceptance evidence, active artifacts, one decision/blocker, exact next phase/action, and budget used. On resume, use a fresh parent session when practical; read the anchor plus only the artifact section needed next, never prior tool history.

## Output

Report: mode, phase/status, changed paths, eval/test results, one decision/blocker, exact next action, current-work path if used, and review result/recommendation.

## Anti-patterns

- Universal tracked/orchestrated workflow
- One fresh agent per plan bullet, file, or repair
- Formal-review loops by default
- Whole-file/artifact dumps in parent context
- Repeated state-anchor reads/updates without a phase transition
- Treating cached giant context as free
