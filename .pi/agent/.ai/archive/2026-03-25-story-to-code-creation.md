# Story-to-Code Prompt Creation

## Status: ✅ Complete

## What was created

- `~/.pi/agent/prompts/story-to-code.md`
  - Lean orchestration prompt for: story → plan → implementation → review → rework
  - Reuses existing agents:
    - `plan-writer`
    - `worker`
    - `code-reviewer`
  - Skips specification phase entirely
  - Retrieves the story first

## Story retrieval behavior

- Prefer a dedicated story retrieval tool if available in the environment
- Default fallback: **Azure DevOps via `az` CLI**
- If nothing else is specified, assume ADO
- If org/project context is missing, the orchestrator asks the user via `questionnaire`

## Assumptions

- Assumed the desired default source is Azure DevOps when no other story source is specified
- Kept the prompt lean and skill-first, with the main agent acting primarily as orchestrator

## Usage

```text
/story-to-code <story reference>
```

Examples:

```text
/story-to-code 123456
/story-to-code https://dev.azure.com/org/project/_workitems/edit/123456
/story-to-code path/to/story.md
```
