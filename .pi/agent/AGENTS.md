# Questions
- If you have open questions, always use the `questionnaire` tool before you start any implementation.
- If you still make assumptions, write them down in the implementation and explain why you made those assumptions.

# Issue Tracking
- This repo uses **Beads** (`bd`) for operational work tracking.
- This repo uses Beads in **local-only stealth mode**. Do **not** add Beads data to tracked git repos and do **not** rely on git sync/remotes.
- Run `bd prime --stealth` at the start of every substantial workflow and again after compaction or a fresh session when context feels thin.
- Beads is the source of truth for operational work state: backlog, ready work, dependencies, claim state, and completion.
- `.ai/` remains the artifact store for specs, plans, review notes, rollout status, and other markdown handoff files.
- Top-level workflows should create or resume an epic/story bead and then create child phase/task beads beneath it.
- For `/story-to-code`, if the workflow resolves a numeric Azure DevOps work item ID, create the top-level bead as `ado-<id>` (using an explicit ID override) and create child beads beneath that story so they inherit IDs like `ado-<id>.1`, `ado-<id>.2`. Otherwise, use the normal `agent` prefix.
- Each substantial sub-agent should handle exactly one claimed child bead/task, report explicit artifact paths, update or close that bead as appropriate, and then exit before the next child bead is selected.
- The repo Beads config sets `no-git-ops: true`, so regular `bd` CRUD commands stay local-only even when they do not accept a `--stealth` flag.
- Do not add a separate Beads session-context extension in this repo; keep `bd prime --stealth` explicit in prompt templates.
- For future bootstrap in similar repos, prefer `bd init --stealth -p agent --skip-agents --skip-hooks`.

# Sub Agents
- Use sub-agents for context management by delegating tasks.
- You will mainly orchestrate the tasks; if the task is not simple and can be delegated, do so.
- When bead context exists, pass the exact bead ID/path into the sub-agent and require it to echo that context in its result.

# Work progress
- If you (or a sub-agent) create a spec/plan/tasks/... artifact, always write it to a markdown file inside `.ai/`.
- Update your current progress in the relevant `.ai/` markdown file so that other agents can resume without rediscovery.
- Link important `.ai/` artifact paths back to the active bead via Beads comments or metadata.
