---
command: work
description: Bounded delivery with direct or delegated execution
model: "@medium"
tools: [read, grep, find, ls, edit, write, bash, subagent]
thinking: medium
---
Deliver bounded work through one worker subagent by default for nontrivial code work. Use direct execution only for obvious one-file, low-risk changes. Use at most one narrow scout before the worker when one stated uncertainty blocks execution. Do not swarm or delegate one task per file/plan bullet. Validate changed files and relevant eval/test evidence. Formal review is explicit; do not auto-fix its findings.

Delegation rule:
- Direct: documentation-only, formatting-only, or obvious one-file low-risk change.
- Worker required: exploration, multiple files, tests, concurrency, external APIs, unclear requirements, or any change needing diagnosis.
- Worker returns compact status, changed paths, eval evidence, one decision/blocker, and one next action; no full files, diffs, or logs.
