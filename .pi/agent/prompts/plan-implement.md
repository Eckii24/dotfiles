---
description: Plan → implement for the active feature tracked in `.ai/current-work.md`
---

Follow the repo workflow and current-work conventions in `AGENTS.md`.
This prompt handles one focused plan-and-implement pass for the active feature.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `scout` agent to find all code relevant to: $@
   - Include `.ai/current-work.md` and any linked artifact paths in the handoff.
2. Then, use the `plan-writer` agent to create or refine the implementation plan for the same active feature using the context from the previous step (`{previous}`).
   - Keep the plan in `.ai/<slug>-plan.md` and require explicit artifact paths.
3. Finally, use the `worker` agent to implement the planned change from the previous step (`{previous}`).
   - Require changed-file paths, any `.ai/` artifact paths, and eval/test results.
4. After the chain returns, update `.ai/current-work.md` before you stop.
   - Link changed files, `.ai/` artifact paths, and eval/test results in the current-work file.
   - If more work remains, revise the evolving plan and next step in `.ai/current-work.md`.

Execute this as a chain, passing output between steps via `{previous}`. Terminate only after `.ai/current-work.md` has the latest implementation status.
