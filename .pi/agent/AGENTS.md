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
- Preserve review evidence in `.ai/<slug>-review.md` or current-work until the user no longer needs it; append resolved/verified notes, do not delete original findings early.
- `AGENTS.md` = compact durable operating rules, not scratchpad.
- Feature closeout: archive only after user confirms work complete. Promote only compact durable rules.
- Use `project-memory` skill only when detailed tracked-work lifecycle/archive/handoff rules are needed.

## Subagents

- Use subagents for context isolation on non-simple work, but keep stop-boundaries short.
- Orchestrator owns workflow loop; workers implement/test; reviewers review only.
- Do not spawn `code-reviewer` during plain implementation, continuation, cleanup, or resume flows that do not include an explicit review stage.
- Run `code-reviewer` when the user explicitly asks for a formal review or the active command/prompt explicitly includes review (for example `/review`, `/implement-review`, `/issues-implement-review`, `/prd-issues-implement-review`).
- In mixed implement+review flows, run formal review at most once, then stop with findings. Do not auto-fix review findings unless the user explicitly asks.
- If a review could help but was not explicitly requested, say so in the summary; do not trigger it yourself.
- When `.ai/current-work.md` or related artifacts exist, pass exact paths to subagents.
- Require subagent outputs to include exact file/artifact paths, not pasted full files/logs.
