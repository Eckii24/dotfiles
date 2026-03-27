---
description: Create or refine the plan for the active feature tracked in `.ai/current-work.md`
---

Follow the repo workflow and current-work conventions in `AGENTS.md`.
This prompt handles one focused planning pass for the active feature.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `scout` agent to find all code relevant to: $@
   - Include `.ai/current-work.md` and any already-linked artifact paths in the handoff.
2. Then, use the `plan-writer` agent to create or refine the implementation plan for the same active feature using the context from the previous step (`{previous}`).
   - Tell `plan-writer` to keep the plan in `.ai/<slug>-plan.md` and echo the current-work context.
3. After the chain returns, update `.ai/current-work.md` before you stop.
   - Record the plan path, current step, linked artifacts, and any open questions in `.ai/current-work.md`.

Execute this as a chain, passing output between steps via `{previous}`. Do NOT implement — return the plan path, current-work path, and any follow-up questions only after `.ai/current-work.md` reflects the latest planning state.
