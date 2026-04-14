# Pi Extension Hooks

- **Sources**:
  - /Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md
  - /Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md

## Key Findings
- `session_start` is the right place to assemble base memory and inspect pending review state.
- `before_agent_start` is the right place to assemble task-specific memory augmentation.
- `session_before_compact` can return a custom compaction payload that preserves memory-aware restart state.
- Extension tools can enforce approval-driven persistence flows without replacing Pi's core session storage.

## Analysis
The memory-system extension relies on Pi's existing lifecycle hooks rather than replacing them. Session start and task start assemble context packages, while the compaction hook preserves bounded restart hints that can later be rehydrated into the task package. This keeps the design aligned with Pi's native extension model.
