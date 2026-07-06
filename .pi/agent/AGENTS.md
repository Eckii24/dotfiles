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

- Use the lightest mode that fits the task:
  - Quick Task: no `.ai/` artifacts by default.
  - Bounded Delivery: optional scout, optional review, no tracked-work unless restart/handoff value is real.
  - Tracked Project: use `.ai/current-work.md` + linked artifacts only for multi-session work, explicit user request, or clear handoff/restart need.
- If `.ai/current-work.md` exists, read it only when the task is tracked or looks like a continuation of that exact work.
- If `current-work.md` is completed, stale, or unrelated, do not drag it into unrelated work; treat it as cleanup/archive candidate, not active context.
- Keep `current-work.md` bounded: objective, minimal Todo Tracker, decisions, state, next restart step, blockers, concise evidence logs.
- Todo Tracker = major phases only. If `.ai/<slug>-stories.md` exists, detailed tasks live there, not current-work.
- Preserve review evidence in `.ai/<slug>-review.md` or current-work until the user no longer needs it; append resolved/verified notes, do not delete original findings early.
- `AGENTS.md` = compact durable operating rules, not scratchpad.
- Feature closeout: archive only after user confirms work complete. Promote only compact durable rules.
- Use `project-memory` skill only when detailed tracked-work lifecycle/archive/handoff rules are needed.

## Subagents

- Use subagents for context isolation on non-simple work, but keep stop-boundaries short.
- Default pattern = optional `scout` -> optional `stories-writer`/`prd-writer` -> `worker` -> optional `code-reviewer`, not agent swarms.
- Orchestrator owns workflow loop; planners decompose/specify; workers implement/test; reviewers review only.
- Do not spawn `code-reviewer` during plain implementation, continuation, cleanup, or resume flows that do not include an explicit review stage.
- Run `code-reviewer` when the user explicitly asks for a formal review or the active command/prompt explicitly includes review (for example `/review` or `/implement-review`).
- In mixed implement+review flows, run formal review at most once, then stop with findings. Do not auto-fix review findings unless the user explicitly asks.
- If a review could help but was not explicitly requested, say so in the summary; do not trigger it yourself.
- When `.ai/current-work.md` or related artifacts exist, pass exact paths to subagents.
- Require subagent outputs to include exact file/artifact paths, not pasted full files/logs.

## Prompt surface

- Canonical workflow entrypoints:
  - `/prd` = specify the work
  - `/prd-to-stories` = break spec/PRD into execution slices
  - `/implement` = implement without automatic formal review
  - `/implement-review` = implement, then run one formal review pass
  - `/review` = review only
- Keep prompt files thin. Heavy reusable procedure text belongs in `~/.agents/skills/*`, not duplicated across many prompts.
- Execution breakdowns are called **stories**.
- Keep only the canonical workflow surface above; do not keep alias prompt families around.
