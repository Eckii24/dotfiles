---
description: Implement → review for a tracked feature
---

## Tracked Work
- If `.ai/current-work.md` exists and relates to this task, continue from it.
- If it tracks a different unfinished feature, ask the user before replacing it.
- Keep exactly one active feature in `.ai/current-work.md`.
- Artifact naming: `.ai/<slug>-review.md`.
- When the feature completes, move artifacts to `.ai/archive/` with dated filenames.
- For `.ai/` conventions (slug, structure, archive format), use the `project-memory` skill.

This prompt assumes a plan already exists in the current-work context.

Use the `subagent` tool with the `chain` parameter to execute this workflow:

1. First, use the `worker` agent to implement: $@
   - Include `.ai/current-work.md` and require explicit changed-file and artifact paths.
2. Then, use the `code-reviewer` agent to review the implementation from the previous step (`{previous}`).
   - Require eval/test results and current-work-aware findings.
3. After the chain returns, update `.ai/current-work.md`:
   - Link review findings, changed files, `.ai/` artifact paths, and eval/test results.
   - If follow-up fixes are needed, capture the next step explicitly.
   - Create or update `.ai/<slug>-review.md` when the review output is substantial.

Execute this as a chain, passing output between steps via `{previous}`. Terminate only after `.ai/current-work.md` has the latest implementation and review status.
