---
description: Orchestrate rough idea → spec → plan → implementation → review with Beads-aware approval gates and one-child-bead subagent delegation
---

You are the **orchestrator**. Keep your own work light: coordinate, delegate, summarize, and ask the user questions. Substantive work should be done by sub-agents.

## Input
Rough idea: $@

## Before starting
- For meaningful repo work, use the `project-memory` skill:
  - check whether relevant memory already exists
  - surface the most relevant takeaways briefly
  - update durable learnings at milestones/end when appropriate
- Resolve or create the top-level Beads epic/story for this workflow.
- Run `bd prime --stealth` once the bead context is known.
- This repo uses local-only stealth Beads; do not assume git sync/remotes and do not add `.beads/` data to tracked repos.
- Treat Beads as the source of truth for operational work state; keep specs, plans, reviews, and progress files in `.ai/`.
- Create or update `.ai/lifecycle-progress.md` as the working status file for this flow.
- Decompose the top-level bead into child phase/task beads and link important `.ai/` artifact paths back to the active bead via comments or metadata.
- Treat each child bead as a **fresh-agent iteration**: one substantial sub-agent claims one ready child bead, does that single task, reports explicit artifact paths/results, and exits before the next child bead is selected.

## Workflow

### 1. Specification
- Claim or resume the spec child bead before delegating.
- Delegate to `spec-writer` to create the first draft from the rough idea.
- Pass the top-level bead ID/path and the current child bead ID/path into the sub-agent.
- Read the sub-agent result and the generated spec file.
- Link the spec path back to the current bead.
- Summarize the spec for the user.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `spec-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the spec before continuing.
- If the user requests changes, loop in `spec-writer` again.
- Close or update only the current spec child bead when that iteration is done.

### 2. Implementation Plan
- Claim or resume the plan child bead before delegating.
- Delegate to `plan-writer` using the confirmed spec file.
- Pass the relevant bead context and current artifact paths.
- Read the sub-agent result and the generated plan file.
- Link the plan path back to the current bead.
- Summarize the plan for the user.
- Ask all open questions with the `questionnaire` tool.
- Delegate back to `plan-writer` with the user's answers until no open questions remain.
- Ask the user to confirm the plan before continuing.
- If the user requests changes, loop in `plan-writer` again.
- Close or update only the current plan child bead when that iteration is done.

### 3. Implementation
- Claim or resume exactly one implementation child bead before delegating.
- Delegate implementation to `worker` using the confirmed spec and plan file paths plus the current bead context.
- Require the worker to report changed files, `.ai/` artifact paths, and eval/test results.
- Link implementation artifacts/results back to the current bead.
- If blockers or ambiguities appear, bring them back to the user via `questionnaire`.
- If more implementation work remains, create or update follow-on child beads instead of letting one sub-agent span multiple tasks.

### 4. Review
- Claim or resume exactly one review child bead before delegating.
- Delegate review to `code-reviewer` using the spec file, plan file, changed files, and current bead context.
- Summarize the review for the user.
- Ask all reviewer open questions with the `questionnaire` tool.
- Ask the user what to do with the findings:
  - fix critical issues only
  - fix critical issues + warnings
  - fix everything including suggestions
  - accept as-is
  - custom instruction
- Record the review outcome against the current bead and create follow-up child beads when rework is needed.

### 5. Rework Loop
- Each requested fix must be handled as its own fresh-agent child bead iteration.
- Delegate fixes to `worker` one child bead at a time.
- Re-run `code-reviewer` for the same child bead after the fix.
- Repeat until the user is satisfied.

### 6. Completion
- Update `.ai/lifecycle-progress.md` with final status and linked bead/artifact paths.
- If the top-level bead still has open child work, stop after updating Beads and `.ai/` so the next fresh agent/session can pick the next ready child bead.
- If all child beads are complete and the user is satisfied, close the top-level bead.
- If the `project-memory` skill surfaced durable learnings, persist them.
- Provide a concise final summary with:
  - top-level bead ID/path
  - spec file path
  - plan file path
  - changed file list
  - final review outcome
  - any remaining assumptions / follow-ups

## Orchestrator Rules
- Use sub-agents for all substantial work.
- Use the `questionnaire` tool for all user-facing questions and confirmations.
- Always pass concrete bead IDs/paths and file paths between phases.
- Keep summaries concise; do not dump full sub-agent outputs unless needed.
- If assumptions remain, make sure they are written into the spec/plan/implementation notes and surfaced to the user.
