---
description: Scout gathers context, plan-writer creates an implementation plan for one claimed bead/task (no implementation)
---

Run `bd prime --stealth` before delegating this workflow.

Treat Beads as the source of truth for operational work state, and keep plans/notes in `.ai/`.
This prompt handles exactly **one** claimed child bead/task per run. Pass any bead ID/path through the chain and require explicit artifact paths in the responses.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `scout` agent to find all code relevant to: $@
   - Include any provided bead ID/path in the handoff.
2. Then, use the `plan-writer` agent to create or refine an implementation plan for the same one child bead/task using the context from the previous step (`{previous}`).
   - Tell `plan-writer` to keep the plan in `.ai/` and echo the bead context.

Execute this as a chain, passing output between steps via `{previous}`. Do NOT implement — just return the plan path and bead context.
