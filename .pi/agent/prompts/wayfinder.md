---
description: Map a large or unclear initiative before a spec; thin entrypoint over wayfinder
---

Read and follow `~/.agents/skills/wayfinder/SKILL.md`.

If tracked work is requested or a relevant `.ai/current-work.md` exists, also read and follow `~/.agents/skills/project-memory/SKILL.md`. Otherwise do not create or update `.ai/` artifacts.

## Entry-point rules

1. Use only when direct `/spec` would force premature scope or architecture decisions.
2. Inspect repository context and relevant `.ai/` and ADR artifacts before asking.
3. Use the existing `questionnaire` for grouped, decision-relevant questions when needed.
4. Create or refine `.ai/<slug>-wayfinder.md` only in tracked mode or when the user requests the artifact.
5. Do not create GitHub issues, a spec, an implementation plan, source changes, or a review.
6. Stop at the decision frontier. Recommend `/spec` only when the initiative is sufficiently bounded.

## Final summary requirements

Include: tracked mode used or not, wayfinder path if created, decisions made, open frontier/blockers, and one exact recommended next step.
