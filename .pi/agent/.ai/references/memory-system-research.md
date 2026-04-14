# Memory System Research

- **Sources**:
  - .ai/self-learning-loop-agent-harness-research.md
  - .ai/self-learning-loop-agent-harness-spec.md

## Key Findings
- A cohesive memory system needs layered memory rather than a single learning store.
- Durable memory should stay file-native and approval-gated in this repo.
- Profiles are compact prompt-ready summaries; they are not the canonical durable source of truth.
- Compaction should preserve restartable hints but those hints still require validation against live files.

## Analysis
The research converged on a layered design where working memory, learnings, durable memory, profiles, references, and compaction all have explicit roles. The Pi harness should keep V1 Markdown-first and file-native, preserve approval gates for durable writes, and treat memory-derived guidance as hints that must be validated before use.
