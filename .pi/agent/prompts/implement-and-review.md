---
description: Single-task implementation/review loop - worker implements one claimed bead/task, code-reviewer reviews it, worker applies requested feedback
---

Run `bd prime --stealth` before delegating this workflow.

Treat Beads as the source of truth for operational work state, and keep review/progress artifacts in `.ai/`.
This prompt handles exactly **one** claimed child bead/task per run. Claim or resume that bead first, pass the bead context to every subagent, and stop after this one implementation/review iteration is complete.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `worker` agent to implement: $@
   - Include the current bead ID/path and require explicit changed-file and artifact paths.
2. Then, use the `code-reviewer` agent to review the implementation from the previous step (`{previous}`).
   - Require eval/test results and bead-aware findings.
3. Finally, use the `worker` agent to apply the feedback from the review (`{previous}`).
   - Keep the work scoped to the same one child bead/task.
4. After the chain returns, update or close the same claimed bead before you stop.
   - Link review findings, changed files, `.ai/` artifact paths, and eval/test results back to the bead.
   - If the review found unresolved issues or another review pass is still required, leave the bead open with explicit notes or create a follow-on child bead.
   - Close the bead only if the review cycle for this child task is actually complete.

Execute this as a chain, passing output between steps via `{previous}`. Terminate only after the current child bead has explicit Beads review/closure state.
