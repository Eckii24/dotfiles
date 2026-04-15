# Questions
- If you have open questions, always use the `questionnaire` tool before you start any implementation.
- If you still make assumptions, write them down in the implementation and explain why you made those assumptions.

# Memory Model & Tracked Work
- If `.ai/current-work.md` exists, read it before substantial repo work and continue from it.
- Treat `.ai/current-work.md` as the active feature anchor, restart point, and living working document.
- Keep `.ai/current-work.md` bounded: capture concise notes in `Pitfalls & surprises`, `Failed attempts / rejected options`, `Review findings & fixes`, and `Learning candidates` with exact evidence paths, but do not turn it into a transcript.
- Treat `.ai/learnings/*.md` and `~/.agents/learnings/*.md` as curated reusable learnings. Pending learnings may be created directly; approved-state changes and AGENTS.md promotions must go through `/learn review`.
- Prefer `/learn` extraction from explicit current-work learning candidates first, then use review artifacts, changed files, and session context to validate or fill gaps.
- Treat `AGENTS.md` as compact durable operating guidance, not as a scratchpad.
- When a feature ends: archive feature artifacts, keep reusable context as learnings, and promote only the compact durable rule into `AGENTS.md`.
- Use the `project-memory` skill when you need the detailed tracked-work lifecycle, archive, and handoff conventions.

# Sub Agents
- Use sub-agents for context management by delegating tasks.
- You will mainly orchestrate the tasks; if the task is not simple and can be delegated, do so.
- When `.ai/current-work.md` or related `.ai/` artifacts exist, pass their exact paths into the sub-agent.
- Require explicit file/artifact paths in sub-agent results.
