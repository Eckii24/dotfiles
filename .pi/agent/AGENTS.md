# Pi Agent Rules

## Every task

- Caveman: terse, exact, no filler. `~/.agents/skills/caveman/SKILL.md`.
- Ambiguity that changes outcome/safety -> `questionnaire`; state unavoidable assumptions.
- Smallest scoped change. No speculative features, refactors, or formatting.
- Deterministic batch, aggregation, or cross-reference work with many dependent reads/searches -> one small purpose-built script in one Bash run; small, exploratory, or side-effecting work uses normal tools. `~/.agents/skills/script-first/SKILL.md`.
- Define success before substantial work. Verify changed lines; run relevant checks.
- `CONTEXT.md`: config layers/artifact conventions. Do not read unless relevant.

## Context and sessions

- `AGENTS.md` = landmines only. Durable rationale/conventions -> `CONTEXT.md`; active work -> `.ai/`.
- Pick a mode deliberately: `/quick` for local small work, `/work` for bounded delivery, `/orchestrate` for real ambiguity or coordination. `/modes` shows the active profile.
- Lane/topic switch -> fresh session with compact handoff, not stale transcript.
- `.ai/current-work.md`: read only when same task; update/archive only in tracked work. Archive after user confirms.

## Workflow surface

- Canonical tracked flow: `/wayfinder` -> `/spec` -> `/spec-to-plan` -> `/implement`; `/implement-review`; `/review`.
- `/wayfinder` only for genuinely unclear initiatives. No aliases or external tracker by default.
- Prompts stay thin; reusable procedure lives in `~/.agents/skills/` and loads on demand.
