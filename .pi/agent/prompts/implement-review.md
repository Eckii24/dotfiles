---
description: Implement → review → fix → re-review for a tracked feature
---

## Tracked Work
- Follow the conventions in the `tracked-work` skill.
- This prompt produces: `.ai/<slug>-review.md`.

## Default review policy
- Do NOT stop after the first review if it returns actionable findings.
- Treat `Critical Issues (Must Fix)` and `Warnings (Should Fix)` as mandatory fix work for this workflow.
- Treat `Suggestions (Consider)` as optional: apply them only when they are clearly correct, low-risk, and within scope; otherwise record them in the review artifact or handoff notes.
- Ask the user via `questionnaire` only when a review finding is ambiguous, changes scope/requirements, or requires a trade-off decision.

## Workflow
Use the `subagent` tool with the `chain` parameter for each implementation/review or repair/review sequence.

1. First, use the `worker` agent to implement: $@
   - Include `.ai/current-work.md` when it exists.
   - Require explicit changed-file, artifact, and eval/test paths/results.
2. Then, use the `code-reviewer` agent to review the implementation from the previous step (`{previous}`).
   - Pass `.ai/current-work.md` when it exists.
   - Require eval/test results and current-work-aware findings.
3. If the review returns any `Critical Issues` or `Warnings`:
   - Create or update `.ai/<slug>-review.md` with the actionable findings before requesting fixes.
   - Run another `subagent` chain: focused `worker` fix pass → `code-reviewer` verification pass.
   - Pass the exact review artifact path, changed files, and prior eval/test context into the fix pass.
   - Repeat the fix → review cycle until the latest review has no `Critical Issues` and no `Warnings`, or until user input is required via `questionnaire`.
4. After the loop, create or update `.ai/current-work.md`:
   - Link the latest review findings, changed files, `.ai/` artifact paths, and eval/test results.
   - Record any remaining suggestions, assumptions, or follow-up items explicitly.
   - Leave the current step clear for the next session.
5. Terminate only when one of these is true:
   - the latest review has no `Critical Issues` and no `Warnings`
   - the user explicitly accepts remaining findings
   - a blocker or ambiguity requires user input via `questionnaire`

Prefer at least one re-review after every fix pass. Keep the loop bounded and surface persistent issues clearly if they cannot be resolved in one session.
