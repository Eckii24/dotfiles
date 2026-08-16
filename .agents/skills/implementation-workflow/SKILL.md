---
name: implementation-workflow
description: Implement a bounded code change from a request, spec, or implementation plan. Use when executing implementation work and choosing between quick, bounded, and tracked modes. Not for producing a spec (use to-spec) or an implementation plan (use to-plan) before coding.
---

# Implementation Workflow

Use for code delivery. Optimize for evidence and signal density, not ceremony.

## Mode choice

| Mode | Use when | Default shape |
|---|---|---|
| Quick Task | Small/local, obvious scope | Direct work; no artifacts/subagents |
| Bounded Delivery | Clear change across ~1-3 areas | Direct work; delegate only at a real responsibility boundary |
| Tracked Project | Multi-session, expensive restart/handoff, or explicitly requested | Phase contracts + `.ai/current-work.md` pointer |

Default Quick/Bounded. Direct work is normal in both. Delegate only for independent evidence, a separately owned deliverable, isolated review, or a context boundary; file count, routine tests, and ordinary diagnosis are not enough. Do not inherit a stale/completed/unrelated anchor.

## Compact inputs

Before work, collect only: objective, acceptance criteria, exact paths/symbols, constraints/non-goals, and test commands. Extract this once into a handoff packet. Do not make every child reread full plan/spec/current-work files.

Use a scout only to answer a real uncertainty. Good output: exact paths, symbols, line ranges, tests, and one start point. Bad output: file dumps or generic architecture prose.

## Delivery shape

When a real boundary exists, give one worker a coherent vertical slice with owned acceptance tests. A plan bullet, file, type error, or local repair is not automatically a boundary. The worker implements, evaluates, and fixes in-scope failures before returning a compact status packet.

Parallelize only read-only or isolated work. Never share a mutable checkout between concurrent workers unless the caller explicitly provides safe isolation.

## Gates, budgets, review

For each phase state: objective, acceptance evidence, child shape, and escalation condition.

- In tracked orchestration, the `/orchestrate` mode owns delegation budgets and stop rules; do not copy them into workers or entrypoints.
- A live/evidence gate gets one diagnosis, one explicit decision, then one rerun. Do not create an artifact-edit chain around the gate.
- Formal review runs only when the user requests it or the chosen entrypoint includes it. For elevated risk, recommend review; do not auto-run or auto-fix it.

## Tracked-project integration

For tracked work, use [project-memory](../project-memory/SKILL.md) as the authoritative anchor, handoff, resume, and archive contract. This workflow owns mode selection and phase delivery; update tracked state only at material boundaries.

## Output

Report: mode, phase/status, changed paths, eval/test results, one decision/blocker, exact next action, current-work path if used, and review result/recommendation.

## Anti-patterns

- Universal tracked/orchestrated workflow
- One fresh agent per plan bullet, file, or repair
- Formal-review loops by default
- Whole-file/artifact dumps in parent context
- Repeated state-anchor reads/updates without a phase transition
- Treating cached giant context as free
