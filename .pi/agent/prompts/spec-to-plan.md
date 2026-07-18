---
description: Turn a bounded spec into an architecture- and code-focused implementation plan; thin entrypoint over plan-writer + to-plan
---

Default to the lightest workflow that can succeed.

## Setup

1. Track only for real multi-session/restart value or explicit request; otherwise stay untracked.
2. In tracked mode, follow `project-memory`; read only the relevant artifact sections.
3. Delegate once to `plan-writer` with concise source, repository paths, constraints, and output path.
4. Inspect repository conventions/source spec before deciding architecture. Ask only blocking questions.

## Plan contract

The plan must organize **coherent vertical phases**, not one worker per file or micro-task. Each phase states:
- objective and acceptance evidence;
- owned code/test areas and dependencies;
- whether a scout/reviewer is justified;
- test/eval commands;
- gate failure behavior and escalation condition.

Use live/evidence gates only where they retire a real uncertainty. A failed gate must have diagnosis -> explicit decision -> one rerun, not a chain of artifact-specific repair missions. Flag safe parallelism only for read-only or isolated work; never imply same-checkout parallel writes are safe.

## Workflow

1. Resolve source: approved bounded spec or direct request.
2. Read back plan result.
3. Fix small wording/scope defects directly; do not restart planning loop.
4. In tracked mode, update anchor only with plan path, phase, acceptance target, and next restart step.

## Final summary

Include: tracked/untracked, plan path, phase structure, key decision, open questions, and recommended next step.
