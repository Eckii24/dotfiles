---
title: Memory System for Pi Agent Harness
date_created: 2026-04-11
status: Historical
tags: feature, memory, agent-harness, learning
---

> **Historical reference only.** The system was simplified to 4 layers (session, working, learning, durable) on 2026-04-14. Profiles were merged into `AGENTS.md` and references were removed. See `.ai/README.md` for the current architecture.

# Memory System for Pi Agent Harness

This specification defines a cohesive memory system for the Pi agent harness at `~/.pi/agent/`. It expands the earlier, narrower self-learning-loop direction into a layered architecture where **session memory, working memory, learnings, durable project memory, profiles, and references** work together instead of competing.

The goal is to make future Pi sessions start faster, repeat fewer mistakes, retain the right level of context, and stay human-auditable. V1 is intentionally **Markdown-first, file-native, and human-editable**. Concepts from LangGraph, Letta, MemGPT, AutoGen, Supermemory, Mem0, and Graphiti inform the design, but V1 adapts them to Pi’s current extension model and `.ai/` workflow instead of introducing external databases or a graph backend.

## Definitions

| Term | Meaning |
|------|---------|
| **Session memory** | Short-term conversational continuity already stored by Pi in session JSONL files, compaction summaries, and branch summaries. |
| **Working memory** | The active feature/task context anchored in `.ai/current-work.md` and related active spec/plan/review artifacts. |
| **Learning record** | An approved, structured note about a recurring mistake, successful tactic, or user preference stored in the canonical learning stores (`global-learning.md` or `learning.md`). |
| **Durable project memory** | Stable repo facts and conventions stored in `.ai/project.md`, `.ai/conventions.md`, `.ai/pitfalls.md`, and `.ai/decisions/`. |
| **Profile** | A compact, prompt-ready summary of stable and current context. In V1 this is a curated Markdown artifact, not a database object. |
| **Reference item** | A document or note stored for pull-based retrieval, usually under `.ai/references/`. It is source material, not extracted memory. |
| **Context package** | The bounded set of memory fragments injected into the LLM context at `session_start` or `before_agent_start`. |
| **Promotion** | Moving a validated pattern from learnings into durable memory such as `conventions.md`, `pitfalls.md`, or a decision file. |
| **Scope** | The applicability boundary of a memory artifact: `global`, `project`, or `feature`. |
| **Forgetting** | Removing, archiving, or superseding memory artifacts that are stale, invalidated, or no longer useful. |

## Design goals

1. **Make memory layered and explicit.** Each type of memory must have a distinct purpose, location, lifecycle, and retrieval strategy.
2. **Keep V1 simple and debuggable.** Prefer files, Markdown, exact paths, and explicit rules over hidden automation.
3. **Preserve human control.** Durable learnings and promotions remain approval-gated.
4. **Reduce prompt bloat.** Inject concise profiles and only task-relevant learnings or references.
5. **Reuse existing Pi primitives.** Build on session files, compaction, extension hooks, prompt workflows, questionnaire, and project-memory conventions.
6. **Support future evolution.** V1 should leave room for later semantic search, richer ranking, graph-like relationships, or optional external memory adapters without requiring them now.

## Requirements & Constraints

### Must

- **M1**: The memory system must distinguish these six layers:
  1. session memory
  2. working memory
  3. learning memory
  4. durable project memory
  5. profile memory
  6. reference memory
- **M2**: V1 must remain **file-native and Markdown-first**. Durable memory artifacts must be readable and editable without special tooling.
- **M3**: V1 must reuse existing Pi and repo structures wherever possible:
  - Pi session files, compaction, and branch summaries for session memory
  - `.ai/current-work.md` for working memory
  - `project-memory` conventions for durable project memory
  - `questionnaire` for approval gates
  - Pi extension hooks (`session_start`, `before_agent_start`, `agent_end`) for application and analysis
- **M4**: The system must support explicit scopes:
  - **Global**: `~/.pi/agent/.ai/**`
  - **Project**: `<project-root>/.ai/**`
  - **Feature**: the active `.ai/current-work.md` anchor and related artifacts
- **M5**: The system must add a **profile layer** with these files:
  - `~/.pi/agent/.ai/user-profile.md`
  - `<project-root>/.ai/project-profile.md`
  Profiles are compact, prompt-ready summaries and are the default base memory injected into new work.
- **M6**: The system must preserve and integrate the learning subsystem from the earlier spec. Approved learning records must be stored in:
  - `~/.pi/agent/.ai/global-learning.md` (user-global)
  - `<project-root>/.ai/learning.md` (project-local)
- **M7**: Learning recommendations must always require explicit user approval before persistence, using the existing `questionnaire` tool.
- **M8**: Each learning store must enforce a maximum of **30 active records**. When full, the system must prompt the user to archive, promote, or delete lower-value records before adding new ones.
- **M9**: Learning promotion eligibility must require **2 confirmed occurrences** from inline or manual analysis only. Scheduled/headless analysis may discover patterns but must **never** increment occurrence counts.
- **M10**: The system must support a **pending recommendations queue** at `<project-root>/.ai/pending-learnings.md` for scheduled/headless discovery awaiting approval in the next interactive session.
- **M11**: The system must add a **reference layer** for source material that should be retrievable but not treated as extracted memory. V1 must support:
  - `<project-root>/.ai/references/index.md`
  - `<project-root>/.ai/references/*.md`
  Optional global equivalents may be added later, but project-local references are sufficient for V1.
- **M12**: Memory application must happen in two steps:
  - **Session-start base package**: inject profiles, active working-memory summary, and approved pending learnings handling
  - **Task-start augmentation**: inject only task-relevant learnings and references
- **M12a**: Memory-derived guidance must be treated as a **hint**, not as the source of truth. When an injected learning, profile item, convention, pitfall, or reference summary makes a factual claim about the current workspace, files, commands, or code behavior, the agent must validate that claim against the live workspace before relying on it. If memory conflicts with the workspace, current files/code win and the memory item must be flagged for review, downgrade, or supersession.
- **M12b**: Promotions into durable memory and material updates to `~/.pi/agent/.ai/user-profile.md` or `<project-root>/.ai/project-profile.md` must require explicit user approval via `questionnaire` before persistence. Scheduled/headless flows may propose such changes but must not apply them automatically.
- **M13**: The total memory context injected by the memory system for a normal task must be bounded to roughly **2000 tokens**:
  - base package target: ≤ 800 tokens
  - task augmentation target: ≤ 1200 tokens
- **M13a**: Session memory handling must include a **memory-aware compaction contract** built on Pi’s existing compaction flow. Using `session_before_compact` or an equivalent hook, the system must preserve at least:
  - active feature slug
  - objective and current-state summary
  - latest confirmed decisions
  - open questions / blockers
  - latest review findings
  - next restart step
  - key changed files
  - 3–8 relevant memory hints with source paths when available
- **M14**: The system must support **lifecycle management**:
  - session memory is compacted/summarized by Pi
  - working memory is archived when a feature completes
  - learning records become stale after 90 days without validation and must be flagged for review
  - profiles must be updated by replacing or revising old summaries, not by unbounded append-only growth
  - reference manifests must allow archiving or deactivation of stale items
- **M15**: Durable memory must remain separate from source/reference documents. Reference items are not automatically promoted into profiles, learnings, or project memory without an explicit extraction or approval step.
- **M16**: The system must support lightweight relationship metadata without requiring a graph backend. V1 artifacts may use fields such as `Supersedes`, `Extends`, and `Derived-from` to express lineage or overlap.
- **M17**: The system must integrate with the existing workflow prompts:
  - `prompts/spec-plan-implement-review.md`
  - `prompts/implement-review.md`
  The learning analysis step must be available as an optional post-review step in both workflows.
- **M18**: The system must not require a new npm dependency, a vector database, or a graph database in V1.

### Must Not

- **MN1**: Must not treat `global-learning.md` or `learning.md` as the entire memory system. Learnings are one layer, not the sole source of memory.
- **MN2**: Must not automatically modify prompts, agent definitions, extension code, or `settings.json` based on inferred memory.
- **MN3**: Must not persist secrets, credentials, or personal data that would be inappropriate for a repo-visible Markdown artifact.
- **MN4**: Must not dump all memory artifacts into every prompt. Retrieval must be selective and budgeted.
- **MN5**: Must not duplicate stable repo facts across profiles, learnings, and durable project memory without a clear rationale. Stable facts belong in durable memory; profiles summarize them.
- **MN6**: Must not let scheduled/headless analysis bypass user approval or promotion thresholds.

### Should

- **S1**: Add a `/learn` command or equivalent prompt path for manual learning analysis.
- **S2**: Add a `/memory-status` command or equivalent UI to show which memory artifacts are active for the current session.
- **S3**: Use exact-path evidence in learning records and profile source sections.
- **S4**: Prefer project-local learnings over global learnings when both match the current task.
- **S5**: Fall back gracefully when profiles or references do not exist.
- **S6**: Implement memory-aware compaction through Pi’s existing compaction lifecycle and prefer `session_before_compact` or an equivalent hook over replacing Pi’s native compaction mechanism.
- **S7**: Keep individual durable memory files under the rough `project-memory` size guidance and split them when necessary.
- **S8**: Keep the architecture compatible with a later optional external-memory adapter, but preserve repo-local `.ai/` artifacts as the canonical source of truth for project and feature memory.

## Memory layers

| Layer | Purpose | Primary storage | Lifetime | Write policy | Retrieval mode |
|---|---|---|---|---|---|
| **L1 Session memory** | Preserve recent conversation continuity | Pi session JSONL, compaction entries, branch summaries | Session to multi-session | Automatic by Pi | Implicit via session context |
| **L2 Working memory** | Track current feature/task state and restartability | `.ai/current-work.md`, active spec/plan/review files | Feature lifetime | Agent/user maintained | Read at start of non-trivial work |
| **L3 Learning memory** | Capture recurring mistakes, tactics, preferences | `~/.pi/agent/.ai/global-learning.md`, `<project>/.ai/learning.md` | Medium-term | Approval-gated | Selective task-time retrieval |
| **L4 Durable project memory** | Store stable repo conventions and decisions | `.ai/project.md`, `.ai/conventions.md`, `.ai/pitfalls.md`, `.ai/decisions/` | Long-term | Read-mostly during active work | Selective + profile-backed |
| **L5 Profile memory** | Provide compact always-relevant context | `user-profile.md`, `project-profile.md` | Long-term but regularly revised | Curated/derived | Inject by default |
| **L6 Reference memory** | Keep source material for pull-based retrieval | `.ai/references/index.md`, `.ai/references/*.md` | Long-lived | User/agent curated | Query-specific retrieval |

## Artifact layout

### Global artifacts

```text
~/.pi/agent/.ai/
  user-profile.md
  global-learning.md
```

### Project artifacts

```text
<project-root>/.ai/
  current-work.md
  project.md
  conventions.md
  pitfalls.md
  decisions/
  project-profile.md
  learning.md
  pending-learnings.md
  references/
    index.md
    *.md
  archive/
```

### Notes

- `current-work.md` remains the single active feature anchor.
- `project-memory` artifacts remain the canonical durable store for repo-wide facts.
- `project-profile.md` and `user-profile.md` are compacted summaries, not the canonical source of truth.
- `references/` contains source material or normalized notes that should be retrievable on demand.

## Interfaces & data contracts

### Profile file template

```md
# User Profile

- **Scope**: global
- **Updated**: YYYY-MM-DD
- **Sources**:
  - /exact/path/to/source.md
  - /exact/path/to/another/source.md

## Stable Preferences
- ...

## Preferred Workflow
- ...

## Current Tendencies
- ...

## Avoid
- ...
```

```md
# Project Profile

- **Scope**: project:<name>
- **Updated**: YYYY-MM-DD
- **Sources**:
  - .ai/project.md
  - .ai/conventions.md
  - .ai/current-work.md

## Stack & Architecture
- ...

## Active Focus
- ...

## Constraints
- ...

## High-Signal Conventions
- ...
```

### Learning record template

```md
## L-<YYYYMMDD>-<NNN> — <short title>

- **Category**: mistake-pattern | successful-tactic | user-preference | convention-discovery | tool-usage-pattern
- **Scope**: global | project:<name> | feature:<slug>
- **Source**: review:<slug> | user-correction:<session> | promotion:<slug> | manual | scheduled-analysis:<date>
- **Created**: YYYY-MM-DD
- **Last validated**: YYYY-MM-DD
- **Occurrences**: <count>
- **Confidence**: high | medium | low
- **Supersedes**: <optional id>
- **Extends**: <optional id>
- **Derived-from**: <optional ids>

### Pattern
[What happened.]

### Recommendation
[What to do differently.]

### Evidence
[Exact paths, excerpts, or session references.]
```

### Reference manifest template

```md
# Reference Index

- **Scope**: project:<name>
- **Updated**: YYYY-MM-DD

| ID | Path | Tags | Status | Summary |
|----|------|------|--------|---------|
| REF-001 | .ai/references/agent-memory-patterns.md | memory, architecture | active | Comparison of memory patterns |
| REF-002 | .ai/references/pi-extension-hooks.md | pi, extensions | active | Relevant Pi extension notes |
```

## Architecture & integration points

## 1. Session-start base package

Use a Pi extension hook at `session_start` to assemble a lightweight base package:

1. Read `~/.pi/agent/.ai/user-profile.md` if present.
2. Read `<project-root>/.ai/project-profile.md` if present.
3. Detect whether `.ai/current-work.md` exists and is relevant to the current cwd.
4. Check for `<project-root>/.ai/pending-learnings.md`.
5. If pending learnings exist, present them for approval via `questionnaire` before memory injection.
6. Inject a compact custom message into session context summarizing:
   - user profile highlights
   - project profile highlights
   - active feature anchor summary (if any)

This base package is persistent session context, not a one-off answer.

## 2. Task-start augmentation

Use `before_agent_start` to assemble a task-specific package for the current user prompt:

1. Classify whether the task is:
   - feature-continuation work
   - repo-specific implementation/review work
   - reference lookup / research work
   - general/global work
2. Read and rank candidate memory sources in this priority order:
   1. relevant `current-work.md` content
   2. project-local learnings
   3. global learnings
   4. relevant durable project memory snippets
   5. matching reference items from `.ai/references/index.md`
3. Deduplicate overlapping advice.
4. Treat all injected memory fragments as guidance, not ground truth. When a selected fragment makes a factual claim about the current workspace, file paths, commands, or code behavior, validate it against the live workspace before relying on it in execution or reasoning.
5. If validation fails or the workspace contradicts the memory fragment:
   - trust the live workspace
   - avoid reinjecting the stale claim unchanged
   - mark the item for review, downgrade, or supersession on the next relevant memory-maintenance pass
6. Inject only the highest-signal results within the task augmentation token budget.

## 3. Session memory and compaction

Pi already provides session files, compaction, and branch summaries. V1 should reuse them as L1 session memory, but with a memory-aware compaction policy.

- Do not replace Pi session storage.
- Do not duplicate session history into another store.
- Use existing compaction and branch summaries as the official short-term continuity mechanism.
- Add a memory-aware compaction step via `session_before_compact` or an equivalent hook.
- The compaction step must preserve, at minimum:
  - active feature slug
  - objective and current-state summary
  - latest confirmed decisions
  - open questions / blockers
  - latest review findings
  - next restart step
  - key changed files
  - 3–8 relevant learnings, conventions, pitfalls, or profile hints with source paths when available
- After compaction, session-start and task-start memory assembly must rehydrate only the relevant preserved items within the defined token budgets.
- Compaction output must distinguish confirmed decisions from memory-derived hints and must not silently convert stale hints into facts.

## 4. Working memory integration

The system must continue to treat `.ai/current-work.md` as the authoritative active feature anchor.

Rules:
- For non-trivial repo work, read `.ai/current-work.md` at the start.
- Record new implementation findings there during active work.
- At feature completion, run a promotion review that can move findings into learnings, profiles, or durable project memory.
- Archive completed feature artifacts using the existing `project-memory` conventions.

## 5. Learning subsystem integration

The existing self-learning-loop design is retained as **Layer 3** of the broader memory architecture.

### Sources for learning analysis

- `agents/code-reviewer.md` output, at minimum:
  - `Critical Issues (Must Fix)`
  - `Warnings (Should Fix)`
- user corrections and overrides
- `current-work.md` promotion candidates
- manual `/learn` runs
- scheduled/headless scans of `.ai/` artifacts

### Modes

- **Automatic**: optional post-step after the review/repair loop in tracked workflows
- **Manual**: `/learn` command or equivalent prompt path
- **Scheduled**: background analysis writes to `pending-learnings.md`, subject to later approval

### Dual-store resolution

When both project-local and global learnings match:
- prefer project-local for the current task
- deduplicate equivalent patterns
- allow promotion from project-local to global only with explicit approval

## 6. Durable memory integration

Durable project memory remains the canonical home for stable repo-wide facts.

Use these destinations:
- `.ai/project.md` — broad repo facts and user preferences that apply to the repo
- `.ai/conventions.md` — repeatable workflow and coding conventions
- `.ai/pitfalls.md` — recurring traps with fixes and evidence
- `.ai/decisions/*.md` — architectural decisions and tradeoffs

Profiles summarize from these files; learnings promote into these files once validated and explicitly approved. Because profiles are prompt-ready summaries rather than canonical truth, material updates to `~/.pi/agent/.ai/user-profile.md` or `<project-root>/.ai/project-profile.md` must also be presented for explicit approval before persistence.

## 7. Reference memory integration

The reference layer is intentionally separate from extracted memory.

Use references for:
- architecture notes
- design research
- normalized external docs
- longer implementation notes not suitable for profiles or learnings

Use references when the agent needs **supporting material**, not when it needs **stable behavioral guidance**.

## Lifecycle rules

## Promotion

Promotion review happens when a feature completes or when a learning record reaches the occurrence threshold.

Any promotion into `conventions.md`, `pitfalls.md`, `decisions/`, `~/.pi/agent/.ai/user-profile.md`, or `<project-root>/.ai/project-profile.md` must be presented for explicit user approval via `questionnaire` before persistence. Scheduled/headless flows may queue proposed promotions, but they must not apply them automatically.

Promote into:
- `conventions.md` when the learning is a durable practice
- `pitfalls.md` when it is a recurring failure mode
- `decisions/` when the rationale and tradeoff must remain visible
- profile files when the information should be always-available context and has a clear source-backed basis

## Archival and forgetting

- **Session memory**: handled by Pi compaction and session history.
- **Working memory**: archive completed features under `.ai/archive/`.
- **Learnings**:
  - records older than 90 days without validation are flagged as stale
  - stale records require keep / archive / delete review
  - promoted records move to an `Archived` section or out of the active set
- **Profiles**:
  - revise or regenerate instead of append-only growth
  - keep concise and source-backed
- **References**:
  - mark entries as `active`, `archived`, or `superseded` in `references/index.md`

## File-native temporal and relationship metadata

V1 adapts graph-memory concepts without a graph database.

Use metadata such as:
- `Supersedes`
- `Extends`
- `Derived-from`
- `Updated`
- `Last validated`

This supports versioning, lineage, and invalidation in a simple Markdown-native way.

## Workflow integration

## Automatic tracked workflow

```text
spec → plan → implement → review → repair loop → [learning analysis] → promotion review → archive/update profiles
```

At the end of the review-repair loop:
1. learning analysis proposes candidate learnings and possible promotions/profile updates
2. user approves/rejects via questionnaire
3. approved learnings are written to the appropriate store
4. promotion candidates are recorded in `current-work.md` or queued for promotion review
5. approved promotions and approved profile updates are applied to durable memory

## Manual flow

```text
User invokes /learn or a memory command
        ↓
learning-analyst reads relevant artifacts
        ↓
proposes recommendations and store targets
        ↓
questionnaire approval
        ↓
persist approved records and approved promotions/profile updates
```

## Scheduled/headless flow

```text
cron/launchd trigger
        ↓
headless Pi run or fallback scanner
        ↓
scan recent .ai artifacts
        ↓
write .ai/pending-learnings.md
        ↓
next interactive session_start presents approvals
        ↓
approved records persisted with source: scheduled-analysis:<date>
```

Scheduled discoveries never increment occurrence counts.

## New artifacts to create

| Artifact | Purpose |
|---|---|
| `~/.pi/agent/.ai/user-profile.md` | Global compact profile for stable user preferences and working style |
| `~/.pi/agent/.ai/global-learning.md` | Global learning store |
| `<project-root>/.ai/project-profile.md` | Compact project profile summarizing stable and current project context |
| `<project-root>/.ai/learning.md` | Project-local learning store |
| `<project-root>/.ai/pending-learnings.md` | Queue for scheduled/headless recommendations awaiting approval |
| `<project-root>/.ai/references/index.md` | Reference manifest |
| `<project-root>/.ai/references/*.md` | Normalized project reference materials |
| `agents/learning-analyst.md` | Dedicated subagent for learning extraction and memory analysis |
| `extensions/memory-system.ts` or similar | Extension implementing retrieval, approval flow, and commands |
| `prompts/learn.md` (optional) | Manual learning-analysis prompt |
| `scripts/scheduled-learn.sh` | Headless scheduled analysis entry point |

## Implementation phases

### Phase 1 — Context assembly foundation

Deliver:
- `user-profile.md`
- `project-profile.md`
- extension hook for session-start base package
- extension hook for task-start augmentation
- task-time selection and token budgeting
- skeptical validation of memory-backed claims against the live workspace

This phase creates the glue that the current memory setup lacks.

### Phase 2 — Learning subsystem integration

Deliver:
- `learning-analyst` subagent
- `/learn` command
- dual-store learnings
- questionnaire approval flow
- tracked workflow integration after review/repair

This phase preserves and implements the strongest parts of the earlier self-learning-loop direction.

### Phase 3 — Promotion and lifecycle hardening

Deliver:
- stale learning review
- promotion to conventions/pitfalls/decisions with explicit approval gating
- profile update rules with explicit approval gating
- memory-aware compaction contract and retained-state format
- archive behavior and relationship metadata support

### Phase 4 — Scheduled analysis and reference retrieval hardening

Deliver:
- headless/scheduled analysis path
- `pending-learnings.md`
- reference manifest support and retrieval ranking improvements
- compaction tuning and rehydration heuristics follow-up if needed

## Acceptance Criteria

- **AC1**: Given `~/.pi/agent/.ai/user-profile.md` and `<project-root>/.ai/project-profile.md`, when a session starts in that project, then Pi injects a compact base package derived from those profiles.
- **AC2**: Given `.ai/current-work.md` exists for the active project, when non-trivial repo work begins, then the working-memory summary is included in the context package.
- **AC3**: Given approved learnings exist in both global and project-local stores, when a task begins, then relevant learnings are merged, deduplicated, and prioritized with project-local items first.
- **AC4**: Given a learning recommendation from review findings or user corrections, when the system wants to persist it, then the user must explicitly approve it via `questionnaire` first.
- **AC5**: Given a learning record reaches 2 occurrences through inline or manual analysis, when the next learning analysis runs, then the system flags it for promotion review.
- **AC6**: Given a scheduled analysis discovery, when it is approved later, then it is persisted with `source: scheduled-analysis:<date>` and does not increase occurrence counts.
- **AC7**: Given the learning store already contains 30 active records, when a new learning is proposed, then the system requires archive/promotion/delete action before adding it.
- **AC8**: Given a task prompt that matches a reference item, when task-start augmentation runs, then the system can include the matching reference summary from `.ai/references/index.md` and the referenced file path.
- **AC9**: Given missing profile files, when the session starts, then the system degrades gracefully by using `current-work.md` and durable project memory without error.
- **AC10**: Given normal task execution, when the full memory system context is injected, then it stays within the defined approximate token budget of 2000 tokens.
- **AC11**: Given a learning record older than 90 days without validation, when analysis runs, then the record is flagged as stale for keep/archive/delete review.
- **AC12**: Given completed tracked work, when promotion review runs, then durable findings are classified into learnings, profiles, durable project memory, or archive only, and proposed durable writes are held for explicit approval before persistence.
- **AC13**: Given V1 implementation, when deployed in this repo, then it requires no new npm dependency, vector store, or graph database.
- **AC14**: Given a memory artifact with `Supersedes`, `Extends`, or `Derived-from` metadata, when reviewed by a future agent, then the lineage is understandable from the file alone.
- **AC15**: Given an injected learning, profile item, convention, pitfall, or reference summary that makes a factual claim about the current workspace, when the agent relies on it, then the claim is validated against the live workspace first and any conflict is resolved in favor of the current files/code.
- **AC16**: Given Pi triggers session compaction, when the memory-aware compaction hook runs, then the compacted state preserves the active feature slug, objective/current state, latest decisions, open questions/blockers, latest review findings, next restart step, key changed files, and a bounded set of relevant memory hints.
- **AC17**: Given a promotion into durable memory or a material update to `user-profile.md` or `project-profile.md`, when the system wants to persist it, then the user must explicitly approve it via `questionnaire` first.

## Examples & edge cases

**Example: project-specific preference**
- Situation: in one repo the user consistently prefers `fetch` over `axios`.
- Expected:
  - learning stored in `<project-root>/.ai/learning.md`
  - once confirmed repeatedly, it may be promoted into `.ai/conventions.md`
  - the project profile summarizes the preference, but the canonical durable form is the convention entry

**Example: global workflow preference**
- Situation: the user prefers concise answers and terminal-first workflows across projects.
- Expected:
  - canonical durable source is `~/.pi/agent/.ai/user-profile.md`
  - matching learnings may exist temporarily, but stable preference should end up in the global profile

**Example: long design note**
- Situation: a 10-page architecture comparison is useful as support material but is too detailed for a profile.
- Expected:
  - store it under `.ai/references/`
  - add it to `references/index.md`
  - retrieve only when task relevance is high

**Edge case: conflicting learnings**
- Situation: an old learning recommends one pattern, a new user correction contradicts it.
- Expected:
  - system flags the conflict
  - user chooses keep / supersede / merge
  - resulting record uses `Supersedes` metadata if replaced

**Edge case: stale profile**
- Situation: `project-profile.md` no longer matches the current architecture.
- Expected:
  - profile is updated from durable sources and active work
  - profile remains a summary, not the canonical source of truth

**Edge case: headless mode unavailable**
- Situation: Pi lacks a practical headless mode for scheduled analysis at implementation time.
- Expected:
  - fallback script scans `.ai/` artifacts heuristically and writes `pending-learnings.md`
  - approval and persistence still happen interactively later

## Rationale & research synthesis

The research suggests that the current “memory feels unrund” problem is not caused by a missing single feature. It is caused by the absence of a unifying architecture.

### What V1 adopts

- **From LangGraph**: explicit separation of short-term/session memory from long-term store memory; summarization matters.
- **From Letta**: compact always-visible memory blocks are valuable; Pi adapts this as profile files.
- **From AutoGen**: memory should support add/query/update-context semantics; Pi adapts this via extension hooks and commands.
- **From MemGPT**: memory should be layered; active context is a small working set, not the entire corpus.
- **From Supermemory**: separate references from extracted memory; use profiles, scoping, and forgetting.
- **From Mem0/Graphiti**: temporal relationships and scoped retrieval matter, but Pi only adopts lightweight metadata for V1.
- **From OB1 / Open Brain**: several operating principles fit Pi well even though the storage model does not. V1 adopts the ideas of high-signal capture instead of raw transcript dumping, extraction of reusable learnings from real work sessions, search-before-create / dedup before persistence, provenance-aware retrieval, and disciplined tool-surface sizing for any future external-memory integration.

### What V1 deliberately defers

- vector search over learnings or references
- graph database infrastructure
- automatic memory extraction into every layer without approval
- complex ranking pipelines requiring external services

### Why a file-native adaptation is correct here

This repo already has:
- Markdown-based project-memory conventions
- tracked feature artifacts under `.ai/`
- extension hooks for injection and orchestration
- a questionnaire UI for human approval
- safe write access to `.ai/**`

A database-first design would introduce significant complexity before the current file-based memory workflow has been fully unified.

### Potential later integration with external memory systems (e.g. OB1)

A later optional integration with an external memory system such as OB1 may be useful, but only as a secondary layer and not as part of the V1 foundation.

Rules for any later integration:
- Repo-local `.ai/` artifacts remain the canonical source of truth for **working memory**, **durable project memory**, and active feature state.
- An external system may be used as an optional **user-global retrieval layer** for cross-project learnings, long-lived references, or promoted global profile material.
- Any external-memory retrieval must remain provenance-aware, token-budgeted, and subject to the same skeptical validation rules as local memory.
- Initial integration should be read-mostly or read-first, with a very small tool surface such as search and explicit approved capture, rather than broad CRUD exposure.
- Raw transcripts, noisy session logs, and unreviewed inferred notes must not be pushed automatically into the external system.
- Promotions from external memory back into local `.ai/` artifacts must remain explicit, reviewable, and approval-gated.

This preserves the current design goal: **V1 stays repo-local, file-based, and auditable**, while leaving room for a future cross-project memory adapter if it proves useful.

## Assumptions

- **A1**: The existing active work is being broadened rather than replaced. I am treating the prior self-learning-loop direction as a subsystem of the broader memory system, because the user explicitly asked for a more cohesive memory architecture.
- **A2**: Pi extension hooks can inject custom context at `session_start` and `before_agent_start` in a way suitable for profile and learning summaries.
- **A3**: The existing `questionnaire` tool is sufficient for approval flows involving learnings, promotions, and conflict resolution.
- **A4**: V1 should prioritize debuggability and auditability over automation sophistication, because the current harness already relies on human-readable Markdown artifacts.
- **A5**: Relationship metadata (`Supersedes`, `Extends`, `Derived-from`) is enough for V1 lineage and does not require a dedicated graph backend yet.

## References

- Research note: `.ai/self-learning-loop-agent-harness-research.md`
- Current work anchor: `.ai/current-work.md`
- Pi extension docs: `~/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Pi compaction docs: `~/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md`
- Pi session docs: `~/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
- Existing extension examples: `extensions/questionnaire.ts`, `extensions/ralph-loop.ts`
- Workflow prompts: `prompts/spec-plan-implement-review.md`, `prompts/implement-review.md`
- Provided external analysis: `/Users/matthiaseck/Library/Mobile Documents/iCloud~md~obsidian/Documents/Wiki/projects/dev-ai-memory.md`
- Additional fetched research: `/tmp/langgraph-memory.md`, `/tmp/letta-memory.md`, `/tmp/letta-memory-blocks.md`, `/tmp/autogen-memory.md`, `/tmp/memgpt-research.md`, `/tmp/mem0-overview.md`, `/tmp/mem0-graph-memory.md`, `/tmp/graphiti-overview.md`
- OB1 / Open Brain reference materials: `https://github.com/NateBJones-Projects/OB1`, `https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/README.md`, `https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/recipes/auto-capture/README.md`, `https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/recipes/claudeception/README.md`, `https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/skills/claudeception/SKILL.md`, `https://raw.githubusercontent.com/NateBJones-Projects/OB1/main/docs/05-tool-audit.md`
