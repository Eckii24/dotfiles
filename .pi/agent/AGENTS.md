# Questions
- If you have open questions, always use the `questionnaire` tool before you start any implementation.
- If you still make assumptions, write them down in the implementation and explain why you made those assumptions.

# Prompt / Agent Boundaries
- `AGENTS.md` is the home for repo-wide workflow policy and shared conventions.
- `prompts/*.md` should focus on orchestration flow and workflow-specific deltas.
- `agents/*.md` should stay moderately thin: role behavior, required skills/resources, and output contracts.
- Do not duplicate repo-wide policy into prompts or agent files unless a short local reminder materially helps execution.

# Current Work
- This repo uses `.ai/current-work.md` as the operational source of truth for active work.
- Read `.ai/current-work.md` at the start of every substantial workflow and continue from it if it already exists.
- For meaningful repo work, use the `project-memory` skill to check for durable memory and persist high-value learnings when appropriate.
- Keep **exactly one active feature** in `.ai/current-work.md`.
- If `.ai/current-work.md` already tracks a different unfinished feature, ask the user via `questionnaire` before replacing it.
- For feature-sized work, keep related artifacts in `.ai/` using this naming scheme:
  - `.ai/<slug>-spec.md`
  - `.ai/<slug>-plan.md`
  - `.ai/<slug>-review.md`
- Treat `.ai/current-work.md` as a living document: update the current step, evolving plan, relevant files, linked artifacts, blockers, and parking lot as you learn.
- Keep the workflow semi-structured and lightweight. Do not rebuild a heavyweight tracker inside markdown.
- Keep top-level `.ai/` limited to current work and long-term memory files; move completed feature artifacts into `.ai/archive/`.
- Use `.ai/archive/` for completed work only; do not use it as the live work surface.
- When a feature completes, move its completed artifacts into `.ai/archive/` using dated filename prefixes and leave `.ai/current-work.md` ready to be replaced by the next active feature.

# Sub Agents
- Use sub-agents for context management by delegating tasks.
- You will mainly orchestrate the tasks; if the task is not simple and can be delegated, do so.
- When current-work context exists, pass the exact `.ai/current-work.md` path and relevant artifact paths into the sub-agent and require explicit file/artifact paths in the result.

# Work progress
- If you (or a sub-agent) create a spec/plan/review/tasks/... artifact, always write it to a markdown file inside `.ai/`.
- Update your current progress in `.ai/current-work.md` and the relevant `.ai/<slug>-*.md` file so that other agents can resume without rediscovery.
- Move completed work artifacts into `.ai/archive/` with dated filename prefixes and keep any completion summary with the archived artifact set.
