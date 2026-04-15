# Thinking & Execution Principles

## Think Before Coding
- If you have open questions, always use the `questionnaire` tool before implementation.
- State assumptions explicitly. If multiple interpretations exist, present them instead of silently choosing one.
- If something is unclear, stop and ask. If a simpler approach exists, say so and push back when warranted.
- If you still make assumptions, write them down in the implementation and explain why you made them.

## Simplicity First
- Write the minimum code that solves the requested problem.
- Avoid speculative features, abstractions, configurability, or error handling that the task does not require.
- If a solution feels overcomplicated, simplify it before proceeding.

## Surgical Changes
- Touch only what is necessary for the request.
- Do not refactor, reformat, or "improve" unrelated code, comments, or files.
- Match the existing style and conventions.
- Remove only imports, variables, or functions made unused by your own changes.
- If you notice unrelated dead code or follow-up cleanup, mention it instead of deleting it.

## Goal-Driven Execution
- Define clear, verifiable success criteria before making substantial changes.
- For bug fixes, reproduce the issue with a test or other concrete check first when practical.
- For multi-step tasks, state a brief plan and the verification for each step.
- Verify that every changed line traces directly to the user's request.

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
