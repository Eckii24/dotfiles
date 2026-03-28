# Questions
- If you have open questions, always use the `questionnaire` tool before you start any implementation.
- If you still make assumptions, write them down in the implementation and explain why you made those assumptions.

# Tracked Work
- If `.ai/current-work.md` exists, read it before substantial repo work and continue from it.
- For meaningful repo work, use the `project-memory` skill to check for durable memory in `.ai/` and persist high-value learnings when appropriate.

# Sub Agents
- Use sub-agents for context management by delegating tasks.
- You will mainly orchestrate the tasks; if the task is not simple and can be delegated, do so.
- When `.ai/current-work.md` or related `.ai/` artifacts exist, pass their exact paths into the sub-agent.
- Require explicit file/artifact paths in sub-agent results.
