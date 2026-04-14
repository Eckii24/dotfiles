# Idea-to-Code Prompt Creation

## Status: ✅ Complete

## Final Design Direction

Refined the initial version to make the system **lean** and **skill-first**:
- prompt template stays focused on orchestration only
- specialized sub-agents stay thin and mainly point to the relevant skills
- detailed logic/templates live in the skill files, not duplicated in agent prompts

## Files Created / Updated

### Prompt Template
- `~/.pi/agent/prompts/idea-to-code.md`
  - Invoked via `/idea-to-code <your rough idea>`
  - Orchestrates: spec → plan → implement → review → rework
  - Uses `questionnaire` for approval gates
  - Mentions `project-memory` for multi-step repo work

### Thin Sub-Agents
- `~/.pi/agent/agents/spec-writer.md`
  - Delegates spec behavior to `create-specification`
- `~/.pi/agent/agents/plan-writer.md`
  - Delegates planning behavior to `create-implementation-plan`
- `~/.pi/agent/agents/code-reviewer.md`
  - Delegates review behavior to `code-review-excellence`

### Reused Existing Agent
- `worker`
  - Used for implementation and rework

## Why this is better

- Avoids prompt/agent duplication
- Keeps skills as the source of truth
- Makes future skill improvements automatically benefit the workflow
- Keeps the main agent in an orchestration role instead of re-describing all task logic

## Usage

```text
/idea-to-code <rough idea>
```

Example:

```text
/idea-to-code Build a feature that lets users export filtered analytics reports as CSV
```
