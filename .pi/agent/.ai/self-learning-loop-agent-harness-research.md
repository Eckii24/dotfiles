---
title: Memory System Research for Pi Agent Harness
date_created: 2026-04-11
status: Review
tags: research, memory, agent-harness, pi, learning
---

# Memory System Research for Pi Agent Harness

This note synthesizes the provided external analysis and additional research on how memory systems are integrated into agent harnesses. It is intended to guide the evolution of the active Pi work from a narrow self-learning loop into a broader, cohesive memory system.

## Executive Summary

The strongest cross-source conclusion is that a good agent memory system is **layered**, not singular.

The current direction in this repo already has one strong layer — tracked work and project memory via `.ai/current-work.md` and the `project-memory` skill — and one promising layer in progress — a learning loop. What is missing is the **architecture that connects all memory layers into one coherent system**.

The research consistently points to these principles:

1. **Separate short-term/session memory from long-term memory.**
2. **Separate raw artifacts from extracted memory.**
3. **Inject only a compact, scoped context package at runtime.** Do not dump the whole memory store into the prompt.
4. **Use explicit scopes** such as user-global, project-local, and feature/task scope.
5. **Support forgetting, invalidation, and promotion.** Memory must have lifecycle management.
6. **Keep a compact profile layer** for always-relevant context.
7. **Treat learnings as one memory layer, not the entire system.**

## Recommendation

**Recommendation: evolve the existing self-learning-loop work into a broader memory-system architecture rather than creating a parallel spec.**

Why:
- The current self-learning-loop spec already solves an important subproblem: capturing recurring learnings.
- The user concern is broader: the memory system feels "unrund" (not cohesive).
- Research shows that learnings alone are insufficient without profiles, scoped retrieval, lifecycle rules, and a clearer separation between session, working, durable, and reference memory.
- Pi already has several strong primitives that can become memory layers without introducing new infrastructure.

In other words: **the current spec should become Layer 3 of a larger memory architecture, not a separate competing system.**

## Sources

### Provided analysis
- `/Users/matthiaseck/Library/Mobile Documents/iCloud~md~obsidian/Documents/Wiki/projects/dev-ai-memory.md`

### Pi and repo context
- `/Users/matthiaseck/.pi/agent/.ai/current-work.md`
- `/Users/matthiaseck/.pi/agent/.ai/self-learning-loop-agent-harness-spec.md`
- `/Users/matthiaseck/.pi/agent/extensions/questionnaire.ts`
- `/Users/matthiaseck/.pi/agent/extensions/ralph-loop.ts`
- `/Users/matthiaseck/.pi/agent/prompts/spec-plan-implement-review.md`
- `/Users/matthiaseck/.pi/agent/prompts/implement-review.md`
- `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md`
- `/Users/matthiaseck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/session.md`

### Additional external research
- `/tmp/langgraph-memory.md` — LangGraph short-term vs long-term memory, semantic stores, summarization, checkpointing
- `/tmp/letta-memory.md` — Letta stateful agents and persisted state
- `/tmp/letta-memory-blocks.md` — Letta memory blocks / always-visible in-context memory
- `/tmp/autogen-memory.md` — AutoGen memory protocol (`add`, `query`, `update_context`)
- `/tmp/memgpt-research.md` — MemGPT hierarchical / virtual context management
- `/tmp/mem0-overview.md` — Mem0 open-source architecture overview
- `/tmp/mem0-graph-memory.md` — Mem0 graph memory integration
- `/tmp/graphiti-overview.md` — Graphiti temporal, dynamic graph memory

## What the sources converge on

## 1. Memory is multi-layered

This is the clearest shared pattern.

- **LangGraph** explicitly separates thread/session memory from long-term store memory.
- **MemGPT** models hierarchical memory tiers like an operating system.
- **Letta** distinguishes always-visible memory blocks from message history.
- **Supermemory/Mem0/Graphiti** distinguish documents, memories, and graph/state structures.
- **AutoGen** treats memory as a store that is queried and injected into the model context before a step.

### Implication for Pi
Pi should not treat memory as a single file or feature. A practical V1 should separate at least:
- session memory
- working memory
- learnings
- durable project memory
- compact profiles
- references/documents

## 2. Retrieval-time injection beats prompt stuffing

All mature memory systems avoid sending everything to the model.

- **AutoGen** uses `query()` + `update_context()`.
- **LangGraph** searches a store and injects only relevant items.
- **Letta** keeps a small always-visible block set, not the whole history.
- **Supermemory** emphasizes profiles and selective retrieval.

### Implication for Pi
Pi should build a **context package** at `session_start` and `before_agent_start`, instead of blindly reading whole memory files into the prompt.

## 3. Profiles / compacted context are a first-class capability

This is one of the strongest ideas across sources.

- **Supermemory** maintains static + dynamic profiles.
- **Letta** has memory blocks pinned in context.
- **LangGraph** relies on summarization of message history and explicit store retrieval.
- **MemGPT** effectively pages between memory tiers and preserves a small active working set.

### Implication for Pi
Pi should have:
- a **user profile** for durable personal preferences and stable behavior constraints
- a **project profile** for stack, architecture, and repo-specific conventions

These should be compact, intentionally curated, and cheap to inject.

## 4. Scoping matters

Every serious system isolates memory by scope.

- **LangGraph** uses namespaces.
- **Mem0** uses `user_id`, `agent_id`, `run_id`.
- **Supermemory** uses container tags / filters.
- **Graphiti** models evolving facts per domain/context.

### Implication for Pi
Pi should support at least three scopes:
- **user-global**: `~/.pi/agent/.ai/**`
- **project-local**: `<project-root>/.ai/**`
- **feature/task**: `.ai/current-work.md` and related artifacts

Without this separation, memory contamination becomes likely.

## 5. Memory needs lifecycle management

The research is very clear that memory cannot be append-only forever.

- **Supermemory** emphasizes forgetting, invalidation, and versioning.
- **Graphiti** emphasizes temporal state and change over time.
- **LangGraph** includes compaction, summarization, trimming, and checkpoint inspection.
- **Letta** persists all messages, but only some memory remains pinned in context.

### Implication for Pi
Pi needs explicit lifecycle rules:
- session compaction for conversational history
- archive completed `current-work`
- stale learning review and pruning
- promotion from learnings into conventions/pitfalls/decisions
- superseding profile updates rather than uncontrolled growth

## 6. Human-in-the-loop remains valuable for dev harness memory

Some platforms let agents directly update memory. That is useful, but risky in a coding harness.

The current repo already leans strongly human-in-the-loop through:
- `questionnaire`
- `project-memory`
- explicit tracked work artifacts

### Implication for Pi
For V1, durable memory writes should remain human-auditable and mostly human-approved.

That especially applies to:
- learnings
- promotions into conventions/pitfalls
- major profile changes

## Comparison matrix

| System | Strong idea | What Pi should adopt | What Pi should defer |
|---|---|---|---|
| LangGraph | Clear split between short-term thread memory and long-term store; summarization/checkpointing | Distinguish session memory from long-term files; use compaction-aware context assembly | Database-backed stores for V1 |
| Letta | Always-visible memory blocks with explicit labels and descriptions | Compact, pinned profile files (`user-profile.md`, `project-profile.md`) | Agent-autonomous block editing for all durable memory |
| AutoGen | Memory protocol with `add/query/update_context` | Introduce the same conceptual flow via Pi extension hooks and commands | Generic pluggable memory backend abstraction in V1 |
| MemGPT | Hierarchical memory tiers / virtual context management | Layered memory architecture and retrieval-time paging | Full OS-style paging abstraction |
| Supermemory | Documents vs memories, profiles, scoping, forgetting, temporal memory | Separate references from extracted memory; add profiles; add lifecycle rules | Full graph memory backend in V1 |
| Mem0 | Hybrid vector + graph memory with scoped metadata | Scope rules, optional relationship metadata, retrieval prioritization | Vector DB + graph DB stack in V1 |
| Graphiti | Temporal, dynamic graph for evolving relationships | Use simple temporal/version metadata in Markdown artifacts | Dedicated graph traversal infrastructure |

## Practical design implications for Pi

## Proposed memory layers

1. **Session memory**
   - Source: Pi session JSONL, compaction entries, branch summaries
   - Purpose: preserve recent conversational continuity
   - Runtime: mostly automatic, not user-authored

2. **Working memory**
   - Source: `.ai/current-work.md`, plus active spec/plan/review artifacts
   - Purpose: current feature state and restartability
   - Runtime: read at the start of non-trivial work

3. **Learning memory**
   - Source: approved learning records from reviews, corrections, and promotion analysis
   - Purpose: recurring patterns and reusable tactics
   - Runtime: selectively injected; promotion-gated

4. **Durable project memory**
   - Source: `.ai/project.md`, `conventions.md`, `pitfalls.md`, `decisions/`
   - Purpose: stable repo facts and preferences
   - Runtime: read selectively; not over-injected

5. **Profiles / compacted memory**
   - Source: distilled summaries from durable and active memory
   - Purpose: always-relevant context with low token cost
   - Runtime: injected by default

6. **Reference memory**
   - Source: `.ai/references/` or equivalent stored docs/specs/notes
   - Purpose: static or semi-static support material
   - Runtime: pull-based, query-specific

## What Pi already has that maps well

### Already strong
- `project-memory` skill gives a good durable-vs-feature distinction.
- `.ai/current-work.md` is already an excellent working-memory primitive.
- Pi session files, compaction, and branch summaries already provide session memory.
- `questionnaire.ts` provides the right approval gate for durable memory writes.
- Extension hooks (`session_start`, `before_agent_start`, `agent_end`) are a strong place for retrieval and memory application.

### Missing glue
- no explicit profile layer
- no unified retrieval policy across memory types
- no reference-store convention
- no lifecycle policy that connects learnings to project memory and profiles
- current self-learning work is too isolated from the rest of the memory stack

## Recommended V1 architecture

### Core decision
Build **a file-native, Markdown-first memory system** that uses Pi’s existing extension and prompt mechanisms.

### Why this is the right V1
- fits the current repo conventions
- human-readable and git-friendly
- avoids database/indexing overhead
- easy to debug and curate
- works with current guardrails and tool permissions
- preserves the existing `project-memory` philosophy

### What this means concretely
- Use Markdown files as the source of truth for durable memory.
- Use session artifacts for short-term memory.
- Use profiles as prompt-ready summaries.
- Use learnings as approval-gated pattern memory.
- Use references as a separate pull-based layer, not as direct memory records.

## What should not be done in V1

- Do not introduce a vector DB or graph DB yet.
- Do not auto-modify prompts, agents, or config based on inferred memory.
- Do not let one flat `learnings.md` file become the entire memory system.
- Do not dump all memory artifacts into every prompt.
- Do not treat chat history as the only memory substrate.

## V1 vs later phases

## V1
- file-native memory layers
- user/project profiles
- approval-gated learnings
- scoped retrieval and injection
- reference manifest / references folder
- lifecycle rules for archive, stale review, promotion

## Later
- semantic search over references and learnings
- relationship extraction (`updates`, `extends`, `derives`) beyond simple metadata
- temporal graph/index for memory navigation
- automatic profile synthesis from memory deltas
- richer ranking heuristics for retrieval

## Main decision for the active feature

The active tracked work should be reframed as:

> Build a cohesive memory system for the Pi agent harness, where the self-learning loop is one subsystem alongside working memory, durable project memory, profiles, and reference retrieval.

This produces a cleaner architecture and directly addresses the user’s dissatisfaction with the current memory setup.

## Assumptions

- I am treating the existing self-learning-loop work as **broadened in scope**, not abandoned, because the new request is adjacent and clearly supersedes the narrower framing.
- I am assuming Pi’s extension hooks are sufficient for context injection and approval flows because the documented `session_start`, `before_agent_start`, and `questionnaire` patterns already exist.
- I am assuming the best V1 outcome is a file-native system because the current repo conventions, guardrails, and skills strongly favor human-readable Markdown artifacts over external services.

## Final takeaway

The research does **not** suggest that Pi needs a sophisticated external memory platform first.

It suggests something more pragmatic:

- keep session memory in Pi sessions
- keep working memory in `.ai/current-work.md`
- keep durable repo memory in project-memory artifacts
- add a profile layer for compact prompt context
- keep learnings as a bounded, approval-gated subsystem
- keep references separate from extracted memory
- glue it together with extension-driven retrieval and lifecycle rules

That is the shortest path from the current “unrund” feeling to a coherent memory system inside this harness.
