---
description: Analyze recent work for candidate learnings, promotions, and profile updates
---

You are the **orchestrator** for manual memory learning analysis. Keep your own work light: gather the right artifacts, delegate extraction to `learning-analyst`, ask for approval with `questionnaire`, and persist only the approved changes.

## Input
Learning focus: $@

## Rules
- Follow the conventions in the `project-memory` skill.
- Read `.ai/current-work.md` when it exists.
- Treat memory artifacts as hints only. Validate live-workspace claims before persisting them.
- Use the `learning-analyst` sub-agent for the analysis pass and require exact evidence paths.
- Use `questionnaire` before any durable write.
- In the same-root case for this repo, persist learnings to:
  - global: `.ai/global-learning.md`
  - project: `.ai/learning.md`
- Otherwise use the normal split:
  - global: `~/.pi/agent/.ai/global-learning.md`
  - project: `<project-root>/.ai/learning.md`
- Pending learning recommendations live at `.ai/pending-learnings.md`.
- Pending durable/profile proposals live at `.ai/pending-memory-proposals.md`.
- Scheduled/headless discoveries must never increment occurrence counts.

## Workflow
1. Read `.ai/current-work.md` and any relevant review artifacts or `.ai/` sources named by the user or implied by the task.
   - When `/learn review ...` includes both pending queue paths, inspect both `.ai/pending-learnings.md` and `.ai/pending-memory-proposals.md` before proposing actions.
2. Delegate to `learning-analyst` with the exact artifact paths.
3. Read the sub-agent result and extract candidate learning recommendations, promotion candidates, and profile update candidates.
4. If there are no candidates, say so and stop.
5. Ask the user to approve or reject the proposed actions with `questionnaire`.
   - For learning records, offer: approve-project, approve-global, queue-only, reject.
   - For promotion/profile updates, offer: approve, defer, reject.
6. Before applying approvals, check whether the target learning store is already at the 30-active-record cap.
   - If a target store is full, ask a follow-up `questionnaire` about the remediation path: archive-lower-value, promote-eligible, delete-lower-value, queue-for-later, reject.
   - Do not treat a full store as silent success.
7. After questionnaire approval, use the `memory_apply_learning_actions` tool to persist approved records, queue deferred ones, and clear reviewed pending items.
   - Update occurrences only for inline/manual approvals.
   - Do not increment occurrences for scheduled/headless recommendations.
   - If the tool reports a capacity block, surface that result to the user and keep the blocked item queued until the user resolves capacity.
8. Explicitly compare candidate learnings against existing approved records. When a matching record reaches 2 confirmed inline/manual occurrences, flag it as a promotion candidate.
9. Only after explicit approval, apply any durable promotion or profile update with `memory_apply_memory_proposals`.
   - Approved durable/profile writes should persist immediately.
   - Deferred durable/profile proposals should stay queued in `.ai/pending-memory-proposals.md`.
10. Report exactly which files were changed and which items were queued or rejected.

## Output
Provide a concise summary with:
- analyzed artifact paths
- approved learning records and their target store paths
- queued items in `.ai/pending-learnings.md`
- approved promotion/profile writes, if any
- any rejected or deferred items
