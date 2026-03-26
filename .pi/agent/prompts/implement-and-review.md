---
description: Single-feature implementation/review loop — worker implements the active feature, code-reviewer reviews it, and worker applies requested feedback using `.ai/current-work.md` as the live hub
---

Follow the repo workflow and current-work conventions in `AGENTS.md`.
This prompt handles one focused implementation/review iteration for the active feature.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `worker` agent to implement: $@
   - Include `.ai/current-work.md` and require explicit changed-file and artifact paths.
2. Then, use the `code-reviewer` agent to review the implementation from the previous step (`{previous}`).
   - Require eval/test results and current-work-aware findings.
3. Finally, use the `worker` agent to apply the feedback from the review (`{previous}`).
   - Keep the work scoped to the same active feature.
4. After the chain returns, update `.ai/current-work.md` before you stop.
   - Link review findings, changed files, `.ai/` artifact paths, and eval/test results in the current-work file.
   - If the review found unresolved issues or another review pass is still required, capture the next step explicitly in `.ai/current-work.md`.
   - Create or update `.ai/<slug>-review.md` when the review output is substantial enough to deserve its own artifact.

Execute this as a chain, passing output between steps via `{previous}`. Terminate only after `.ai/current-work.md` has the latest implementation/review status.
