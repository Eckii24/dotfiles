---
name: implementation-workflow
description: Implement a bounded code change from a request, spec, or implementation plan. Use when executing implementation work and choosing between quick, bounded, and tracked modes.
---

# Implementation Workflow

Use this skill for actual code delivery work. Keep orchestration narrow. Optimize for signal density, not ceremony.

## Mode choice

Pick the lightest mode that can still succeed:

| Mode | Use when | Default artifacts |
|---|---|---|
| Quick Task | Small/local change, obvious scope, focused fix | none |
| Bounded Delivery | Clear implementation across ~1-3 areas, maybe optional review | none by default |
| Tracked Project | Multi-session, explicit handoff/resume need, or user explicitly wants `.ai/` artifacts | `.ai/current-work.md` + linked artifacts |

Rules:
- Default to **Quick Task** or **Bounded Delivery**.
- Use **Tracked Project** only when there is a concrete restart/handoff benefit.
- If `.ai/current-work.md` exists but is stale/completed/unrelated, do not inherit it.

## Inputs

Before delegating implementation, collect only the minimum useful context:
- requirement summary / acceptance criteria
- relevant files or symbols if already known
- spec / implementation-plan paths when they materially help
- constraints, non-goals, and tests to preserve

If codebase location is unclear, run a narrow scout first.

## Scout policy

Use a scout only when it reduces ambiguity.

Good scout outputs:
- exact file paths
- key functions/types/symbols
- which file to start with
- relevant tests or neighboring patterns

Bad scout outputs:
- whole-file dumps
- rephrased obvious context
- architecture essays for a local fix

## Worker policy

The worker should:
- implement only the delegated scope
- run relevant eval/test commands
- return changed paths, artifacts, and results
- report blockers/uncertainties tersely
- not perform formal review

## Verification policy

After worker output:
1. check changed files against requirements
2. inspect eval/test output
3. apply only obvious low-risk cleanup if clearly in scope
4. if correctness remains unclear, ask targeted questions or run review; do not start open-ended loops

## Review policy

- No automatic formal review in plain implementation mode
- For explicit review flows, run one independent formal review pass only
- Prefer existing review skill/agent contracts over embedding review logic here
- Do not auto-fix review findings unless the user explicitly asks

## Tracked-project integration

Only in tracked mode:
- read/update `.ai/current-work.md`
- keep Todo Tracker at major-phase granularity only
- keep detailed execution structure in the implementation plan, not current-work
- ask about archive/closeout only when the task is actually tracked

## Output expectations

Summaries should include:
- mode used
- changed files
- artifact paths if any
- eval/test results
- review recommendation or review outcome
- assumptions / blockers / next step

## Anti-patterns

Avoid:
- universal spec/plan/tracked workflow for every small change
- auto-creating `.ai/*` files for one-shot tasks
- using multiple subagents when one worker would do
- mixing implementation and formal review in one worker
- pasting large logs/files into summaries
