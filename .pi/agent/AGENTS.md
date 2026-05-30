# AGENTS.md - Agent Operating Guidelines

## Communication

Follow `~/.agents/skills/caveman/SKILL.md` always. Terse, exact, no filler. Code/errors exact.

## Execution principles

- If requirements unclear, stop and use `questionnaire` before implementing.
- State assumptions when unavoidable; prefer asking over guessing.
- Do smallest change that satisfies request. No speculative features/abstractions.
- Touch only necessary files. No unrelated refactor/reformat/cleanup.
- Match existing style. Remove only imports/vars made unused by your change.
- Define success criteria before substantial changes. For bugs, reproduce or create concrete check when practical.
- Verify every changed line traces to user request.

## Memory / tracked work

- If `.ai/current-work.md` exists, read it before substantial repo work. Treat as active feature anchor/restart point.
- Keep `current-work.md` bounded: objective, minimal Todo Tracker, decisions, state, next restart step, blockers, concise evidence logs.
- Todo Tracker = major phases only. If `.ai/<slug>-issues.md` exists, detailed tasks live there, not current-work.
- Preserve review evidence in `.ai/<slug>-review.md` or current-work until learning extraction mined it; append resolved/verified notes, do not delete original findings early.
- Learnings: `.ai/learnings/*.md`, `~/.agents/learnings/*.md`. Pending can be created directly; approved changes/promotions go through `/skill:learn review`.
- Extract learnings from explicit current-work candidates first, then review artifacts, changed files, session context.
- Run `learn-orchestrator` when reusable evidence exists; for trivial/clean work, explicitly record skip reason instead of spawning it.
- `AGENTS.md` = compact durable operating rules, not scratchpad.
- Feature closeout: do learning extraction/review or explicit no-candidate skip before final summary. Archive only after user confirms work complete. Promote only compact durable rules.
- Use `project-memory` skill only when detailed tracked-work lifecycle/archive/handoff rules are needed.

## Subagents

- Use subagents for context isolation on non-simple work, but keep stop-boundaries short.
- Orchestrator owns workflow loop; workers implement/test; reviewers review only.
- When `.ai/current-work.md` or related artifacts exist, pass exact paths to subagents.
- Require subagent outputs to include exact file/artifact paths, not pasted full files/logs.
