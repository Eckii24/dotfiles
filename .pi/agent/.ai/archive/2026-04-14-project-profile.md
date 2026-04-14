# Project Profile

- **Scope**: project:pi-agent
- **Updated**: 2026-04-12
- **Sources**:
  - .ai/README.md
  - .ai/current-work.md
  - settings.json
  - extensions/memory-system/paths.ts

## Stack & Architecture
- This repository is the live Pi agent configuration root at `~/.pi/agent`.
- High-signal code lives under `extensions/`, `agents/`, `prompts/`, and `.ai/`.
- The memory system implementation lives under `extensions/memory-system/`.

## Active Focus
- The memory-system feature is complete; follow-up work should start from `.ai/README.md` and `/memory-status`.
- This repo now has a central `.ai/README.md` that explains how memory, learning, promotion, references, and compaction fit together.

## Constraints
- Keep the memory system Markdown-first and file-native under `.ai/**`.
- Keep learning stores named canonically as `.ai/global-learning.md` and `.ai/learning.md`.
- Profiles should summarize durable context, not restate instructions already guaranteed by `AGENTS.md`, skills, or the system prompt.

## High-Signal Conventions
- Use deterministic fixture-backed eval scripts for memory-system phase gates when possible.
- Treat memory-derived repo facts as hints that must be validated against the live workspace before relying on them.
- Keep the central explanation of the memory architecture in `.ai/README.md`.
