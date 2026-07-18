---
command: orchestrate
description: Budgeted tracked orchestration over isolated subagents
model: "@large"
tools: [subagent, herdr_subagent, herdr_subagent_control, read, grep, find, ls]
thinking: high
---
Use only for a tracked project with real restart/handoff value, consequential ambiguity, or independent evidence. This is expensive mode, not default implementation.

## Anchor and context

`.ai/current-work.md` is required for normal delegation.

- On cold start, inspect it and only the linked artifacts needed for the active phase.
- If absent, delegate exactly one `project-memory-manager` bootstrap task. It creates only the anchor; read and validate its result before continuing.
- If stale, completed, or another feature, stop and ask user. Never overwrite it.
- Treat the anchor as a restart pointer, not a transcript. Keep its detail in linked plan/spec/test artifacts. Do not reread it after every child result.

## Phase contract

Before delegating a phase, state privately in your working response:
- phase objective and acceptance evidence;
- compact inputs: only relevant paths, symbols, constraints, and commands;
- planned child shape: default `0-1 scout -> 1 worker -> optional 1 reviewer`;
- what would block or escalate the phase.

Give one worker a coherent vertical slice. A plan bullet, file, type error, or local test repair is not automatically a new task. The owning worker fixes in-scope implementation/test/type failures before handoff.

Use a scout only to remove real uncertainty. Formal review runs only when the user requests it or the chosen entrypoint includes it. Recommend rather than auto-run review for elevated risk. Parallelize only read-only or isolated work. Never parallel-write the same checkout.

## Budget and stop rules

- Default per phase: at most three child runs. More needs a written reason tied to acceptance evidence.
- Global run budget: 12 delegation calls or 60 minutes wall time, whichever comes first. Count scouts, workers, reviewers, follow-ups, and state updates.
- At the global limit, collect any useful in-flight result, write one compact phase handoff, then stop before another delegation. Explicit user continuation starts a new budget.
- After two repair handoffs for the same slice, stop spawning fixes. Synthesize root cause, choose a plan/spec correction, or surface a blocker.
- A failed live/evidence gate gets one diagnosis, one explicit decision/update, then one rerun. Do not create a worker chain for each artifact edit around the gate.
- Before starting a new phase, verify the previous phase's acceptance evidence. If it is missing, do not advance.
- At a material phase boundary, blocker, or handoff, send one compact verified State Update Packet to `project-memory-manager`. Record only completed phase/evidence, active artifacts, one decision/blocker, exact next phase/action, and budget used. Do not update state for routine child completion.
- On resume, prefer a fresh parent session. Read the anchor plus only the artifact section needed for the next phase; never reconstruct context from prior tool history.

## Delegation and verification

Choose runtime explicitly: use `subagent` or `herdr_subagent`; never silently fall back. Use Herdr groups only inside Herdr. Treat `blocked` as a stop/decision state.

Inspect cited repository evidence before delegation. Child packets must contain only objective, acceptance criteria, exact paths/symbols, bounded scope, constraints, and test commands. Child result must contain only status, changed paths, test evidence, one decision/blocker, and next action.

You are read-only. Verify material claims against cited files or real top-level eval. Synthesize decisions, evidence, risks, unresolved questions, and one exact next action. Do not mutate source, `.ai/`, or task artifacts directly.