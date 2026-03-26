---
description: Single-task implementation workflow - scout gathers context, plan-writer creates/refines a plan, worker implements one claimed bead/task
---

Run `bd prime --stealth` before delegating this workflow.

Treat Beads as the source of truth for operational work state, and keep plans/progress notes in `.ai/`.
This prompt handles exactly **one** claimed child bead/task per run. Claim or resume that bead before delegation, pass the bead context through the chain, and stop after this single task is implemented.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `scout` agent to find all code relevant to: $@
   - Include the current bead ID/path if one is available.
2. Then, use the `plan-writer` agent to create or refine the implementation plan for the same one child bead/task using the context from the previous step (`{previous}`).
   - Keep the plan in `.ai/` and require explicit artifact paths.
3. Finally, use the `worker` agent to implement the planned change from the previous step (`{previous}`).
   - Require changed-file paths, any `.ai/` artifact paths, and eval/test results.
4. After the chain returns, update the same claimed bead before you stop.
   - Link changed files, `.ai/` artifact paths, and eval/test results back to the bead.
   - Close the bead if the single-task implementation is complete.
   - If more work remains, update the bead status/notes and create a follow-on child bead instead of silently ending with stale Beads state.

Execute this as a chain, passing output between steps via `{previous}`. Terminate only after the current child bead has been updated or closed.
