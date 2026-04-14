---
title: Learning & Memory System — End-to-End Redesign
date_created: 2026-04-14
status: Draft
tags: feature, memory, learnings, agent-harness
---

# Learning & Memory System — End-to-End Redesign

This specification defines the complete learning and memory flow for the Pi agent harness. It replaces the existing monolithic learning-store files (`learning.md`, `global-learning.md`, `pending-learnings.md`) and their supporting code with a **one-file-per-learning** model under scannable directories. The redesign removes learning classification, archive handling, index files, and per-record IDs in favor of minimal YAML frontmatter, filesystem-based discovery, and git-history-based provenance.

This is a **hard-breaking replacement**. The old monolithic files and their code paths are dropped entirely — no migration, no backward compatibility.

The target audience is the plan writer and implementer who will build this system.

## Definitions

| Term | Meaning |
|------|---------|
| **Learning** | A single, approved observation about a pattern, preference, or tactic. Stored as one Markdown file. |
| **Pending learning** | A candidate learning that has been discovered but not yet reviewed/approved by the user. |
| **Global learning** | A learning that applies across all projects. Stored under `~/.agents/learnings/`. |
| **Project learning** | A learning that applies to a specific project. Stored under `<project-root>/.ai/learnings/`. |
| **Frontmatter** | YAML block at the top of each learning file, used for scanning without reading the body. |
| **Body** | The Markdown content below frontmatter. Contains extended detail, evidence, and rationale. Read on demand when an agent opens the file. |
| **Durable memory** | Long-lived, stable facts stored in `AGENTS.md`. Promotion target for mature learnings. |
| **Context package** | The bounded set of learning references injected into the LLM context at session start. |
| **`/learn`** | The user-facing command that acts as the curator for all learning lifecycle operations. Has two modes: creation (`/learn [focus]`) and review (`/learn review`). |

## Requirements & Constraints

### Storage model

- **Must**: Store each learning as a single Markdown file.
  - Project learnings: `<project-root>/.ai/learnings/<short-title>.md`
  - Global learnings: `~/.agents/learnings/<short-title>.md`
- **Must**: Derive the filename from the learning summary as a **1–5 word slug** that captures the core idea. Lowercase, hyphenated, strictly 1–5 hyphen-separated words.
  - Example summary: "Always treat memory-derived facts as hints — validate against the live workspace before relying on them."
  - Filename: `validate-memory-hints.md`
- **Must not**: Generate filenames longer than 5 hyphen-separated words. If the summary is long, extract the most meaningful 1–5 content words.
- **Must not**: Use IDs in filenames or frontmatter.
- **Must**: When a filename collision occurs, treat it as a **consolidation signal**. The system must present the existing file and the new candidate side by side and offer the user a choice:
  - Merge the new content into the existing file
  - Replace the existing file with the new one
  - Skip (discard the new candidate)
- **Must not**: Auto-create suffixed filenames (e.g. `validate-memory-hints-2.md`). Numeric suffixes are never generated.
- **Must**: Use YAML frontmatter for scanning and discovery. The system must be able to discover learnings by reading frontmatter only — without parsing the body.
- **Must**: Approved learning frontmatter contains exactly these fields:

  ```yaml
  ---
  created: 2026-04-14
  lastReviewed: 2026-04-14
  summary: "One-sentence summary injected into context."
  ---
  ```

- **Must not**: Include `confidence`, `scope`, `category`, `supersedes`, `derived-from`, `id`, `title`, or other fields in approved learning frontmatter.
- **Must not**: Use an index file as the primary storage or discovery mechanism.
- **Must**: Keep evidence, rationale, and extended detail in the body — not in frontmatter.
- **Must not**: Implement archive handling for learnings. Deletion removes the file; git history provides the audit trail.

### Learning file body template

- **Must**: When a learning file is created, populate the body with structured sections so that an agent opening the file gets actionable detail. The body template is:

  ```markdown
  ## Why

  [Why this learning matters. What went wrong or right that led to it.]

  ## When to Apply

  [Concrete situations, triggers, or patterns where this learning is relevant.]

  ## When Not to Apply

  [Situations where this learning does not apply or could be counterproductive.]

  ## Details

  [Extended explanation, examples, evidence, file paths, or code snippets as appropriate.]
  ```

- **Should**: Populate all four sections when enough context exists. If a section has nothing meaningful, it may be omitted — but `## Why` and `## When to Apply` should always be present.
- **Should**: Include concrete file paths, code snippets, or references in `## Details` when available.

### Pending learnings

- **Must**: Store pending (unreviewed) learnings as files in a `pending/` subdirectory alongside approved learnings:
  - Project: `<project-root>/.ai/learnings/pending/<short-title>.md`
  - Global: `~/.agents/learnings/pending/<short-title>.md`
- **Must**: Pending learning frontmatter contains exactly these fields:

  ```yaml
  ---
  created: 2026-04-14
  summary: "One-sentence summary of the candidate learning."
  ---
  ```

- **Must not**: Include `source`, `confidence`, or other extra fields in pending frontmatter. Source and trust context belongs in the body (e.g., in `## Details` or a `## Source` section).
- **Must**: On approval (during `/learn review`), move the file from `pending/` to the parent learnings directory (project or global, depending on the user's choice), add `lastReviewed: <today>` to frontmatter, and populate the body if it was sparse. The filename stays the same unless it collides with an existing approved file (in which case, apply the consolidation flow).
- **Must**: On rejection, delete the file from `pending/`.

### Automated pending-learning creation

The system must partially automate the discovery of candidate learnings. Manual-only discovery misses patterns that emerge from reviews, implementation sessions, and generated documentation.

- **Must**: The `/learn [focus]` creation mode writes discovered candidates directly as pending learning files — no approval questionnaire gates the write. The candidates are always written to the project `pending/` directory by default.
- **Must**: After writing pending files, the system must ask the user: "N pending learnings created. Review them now?" If yes, dispatch `/learn review`. If no, continue normally.
- **Must**: The `learning-analyst` sub-agent, when invoked, mine the following sources for candidate learnings:
  - `.ai/current-work.md` — active feature context and constraints
  - Recent review artifacts (`.ai/reviews/`, code-review output)
  - Recently changed files (via `git diff` or similar)
  - Generated documentation and specs under `.ai/`
  - Session conversation context (what went well, what was corrected, what was repeated)
- **Must**: The learning-analyst should produce candidates with full body content (all four template sections) based on the evidence it finds, not just summaries.
- **Must**: At Pi session start, if pending learnings exist in either `pending/` directory, display a short notice and ask the user whether they want to review them now. If yes, dispatch `/learn review`. If no, continue normally.
- **Should**: The learning-analyst should prefer fewer, higher-quality candidates over many low-quality ones. Aim for 1–5 candidates per analysis run.
- **Should**: When creating pending files, check for collisions against both `pending/` and the parent approved directory. If a collision is found, treat it as a consolidation signal (same as for approved files).

### Discovery and context injection

- **Must**: At session start, scan all approved learning directories by reading frontmatter only.
- **Must**: Inject **all approved learnings** into the context package. There is no token budget, ranking, or selection — the full set is injected every time. The `/learn` lifecycle (review, consolidation, deletion) is responsible for keeping the set small and relevant.
- **Must**: Inject only the `summary` field value and filename from each learning. The body is never injected into context.
- **Must**: Format the injection block as follows:

  ```
  Memory · learnings · N refs
  Treat learning refs as hints; validate live workspace facts before relying on them.
  Project (.ai/learnings):
  - validate-memory-hints.md — Validate memory-derived claims against live files before relying on them.
  - sub-agent-context-isolation.md — Prefer sub-agents for context isolation when tasks touch multiple files.
  Global (~/.agents/learnings):
  - concise-questionnaire-options.md — Keep questionnaire labels short; use descriptions for extra context.
  ```

  Where `N` is the total number of learning refs across both scopes.
- **Must**: Prefer project learnings listed before global learnings in the injection block.
- **Must**: If a scope has no learnings, omit that scope's section entirely.
- **Must**: Treat all injected learnings as **hints, not ground truth**. The injection wrapper must instruct the agent to validate memory-derived claims against the live workspace before relying on them (as shown in the injection format above).

### Sub-agent injection

- **Must**: Sub-agents (when `PI_SUBAGENT=1`) **also receive learning injection**. The injected refs are lightweight (filename + one-line summary per learning) and the cost is low enough to justify universal injection.
- **Must**: Sub-agents receive the same injection format as the orchestrator.
- **Must**: Sub-agents do not trigger pending-learning review prompts or any interactive learning lifecycle flows. Only the orchestrator handles interactive flows.

### `/learn` command — the curator

The `/learn` command is the single entry point for all learning lifecycle operations. It has exactly **two modes**: creation and review. There are no other top-level subcommands.

#### Creation mode: `/learn [focus]`

Creation mode discovers candidate learnings and writes them as pending files. It does **not** require user approval to write pending files — the review step is separate.

- **Must**: Analyze recent work artifacts (`.ai/current-work.md`, review files, changed files, session context) for candidate learnings.
- **Must**: Delegate analysis to the `learning-analyst` sub-agent, passing explicit artifact paths and the sources listed in the automated pending-learning creation section.
- **Must**: Write all discovered candidates directly as pending learning files in the project `pending/` directory. No approval questionnaire gates this write.
- **Must**: After writing, report what was created and ask: "N pending learnings created. Review them now?"
  - If yes → dispatch `/learn review` (which handles approval, scoping, promotion, and rejection).
  - If no → done. The pending files wait for the next review.
- **Must not**: Present an approval questionnaire before writing pending files. The creation-to-pending path is frictionless; curation happens during review.

#### Review mode: `/learn review`

Review mode is the **single curation command**. It handles pending review, existing-learning review, consolidation, and normalization cleanup — all in one flow. There are no separate `/learn consolidate`, `/learn cleanup`, or `/learn promote` commands.

The review flow proceeds in three phases, in order:

**Phase 1 — Pending review:**

- **Must**: Scan `pending/` directories (project and global) for unreviewed candidates.
- **Must**: If pending learnings exist, present each one to the user via `questionnaire`.
- **Must**: Each question must include a **recommendation** as the first option. The recommendation is the system's best guess based on the learning's content, source, and scope relevance.
- **Must**: Pending review options (in this order):
  1. **[Recommended]** — whichever of the below the system recommends, marked clearly
  2. **Keep as project learning** — approve and move to `<project-root>/.ai/learnings/`
  3. **Keep as global learning** — approve and move to `~/.agents/learnings/`
  4. **Promote into project AGENTS.md** — compact into durable memory in `<project-root>/AGENTS.md` (see Promotion rules), then delete the pending file
  5. **Promote into global AGENTS.md** — compact into durable memory in `~/.pi/agent/AGENTS.md` (see Promotion rules), then delete the pending file
  6. **Reject** — delete the pending file

- **Must**: On "Keep as project/global learning": move the file from `pending/` to the appropriate approved directory, add `lastReviewed: <today>` to frontmatter.
- **Must**: On "Promote into AGENTS.md": execute the promotion flow (see Promotion rules below), then delete the pending file.
- **Must**: On "Reject": delete the pending file.

**Phase 2 — Existing-learning review:**

- **Must**: After pending review completes (or if no pending learnings exist), offer to review existing approved learnings: "Review N existing learnings?"
- **Must**: If the user confirms, present each approved learning via `questionnaire`.
- **Must**: Each question must include a **recommendation** as the first option.
- **Must**: Existing-learning review options (in this order):
  1. **[Recommended]** — whichever of the below the system recommends, marked clearly
  2. **Keep** — update `lastReviewed` to today; no other change
  3. **Promote to global learning** — (only shown for project-scoped learnings) move the file from `<project-root>/.ai/learnings/` to `~/.agents/learnings/`, update `lastReviewed`
  4. **Promote into project AGENTS.md** — compact into durable memory in `<project-root>/AGENTS.md` (see Promotion rules), then delete the learning file
  5. **Promote into global AGENTS.md** — compact into durable memory in `~/.pi/agent/AGENTS.md` (see Promotion rules), then delete the learning file
  6. **Remove** — delete the learning file (git preserves history)
  7. **Consolidate with another** — present a list of other learnings to merge with; user picks the merge target, system combines both into one file, deletes the other

- **Must**: "Promote to global learning" is only shown when the learning being reviewed is a project learning. It moves the file from the project learnings directory to the global learnings directory. This is a scope change, not a promotion to `AGENTS.md`.
- **Must**: "Consolidate with another" presents other learnings (same scope first, then cross-scope) as merge candidates. On selection, the system merges the two learning files into one (combining bodies, keeping the more descriptive summary), deletes the other file, and updates `lastReviewed` on the merged result.
- **Should**: Sort learnings for review by `lastReviewed` date ascending (oldest-reviewed first) so stale learnings surface naturally.
- **Must not**: Implement time-based staleness rules or automatic expiration. The review cycle is the lifecycle mechanism.

**Phase 3 — Normalization check:**

- **Must**: After existing-learning review, scan all remaining learning files and check:
  - Filenames are strictly 1–5 word lowercase hyphenated slugs (each hyphen-separated token counts as one word)
  - Frontmatter contains exactly the required fields (no extra fields, no missing fields)
  - Body follows the template structure
- **Must**: If issues are found, present proposed normalizations to the user via `questionnaire` before applying.
- **Should**: If no issues are found, skip this phase silently.

### Recommendation logic for review questions

- **Must**: Every review question (pending or existing) must include a recommendation as the **first option** in the questionnaire.
- **Must**: The recommendation label must clearly indicate what is recommended, e.g. `Keep as project learning (recommended)` or `Recommended: keep`.
- **Should**: The recommendation is based on heuristics:
  - For pending learnings: if the content is project-specific (references project files, project-specific patterns), recommend "Keep as project learning". If it's general, recommend "Keep as global learning".
  - For existing learnings reviewed recently (`lastReviewed` within 30 days), recommend "Keep".
  - For existing learnings that are old, well-established, and stable, recommend "Promote into AGENTS.md".
  - For existing learnings with no clear ongoing value, recommend "Remove".
  - For pending learnings of exceptionally high signal (stable, widely applicable), recommend "Promote into AGENTS.md".
- **Should**: When the system cannot determine a strong recommendation, default to "Keep" for existing learnings and "Keep as project learning" for pending learnings.

### Promotion rules (AGENTS.md integration)

Promotion moves a learning's core insight into durable memory (`AGENTS.md`), making it part of the agent's permanent instruction set.

- **Must**: Promotion is triggered exclusively from `/learn review` — as an option when reviewing pending or existing learnings. There is no standalone `/learn promote` command.
- **Must not**: Append blindly to a generic `# Learned` section. Instead, the system must:
  1. **Compact** the learning file's full content (summary + body) into its **core durable essence** — a concise directive or fact, stripped of evidence, rationale, and situational detail. The compacted form should read naturally as an instruction in `AGENTS.md`.
  2. **Analyze** the target `AGENTS.md` file to identify its existing sections and structure.
  3. **Place** the compacted content into the **most fitting existing section** in `AGENTS.md`. If the content fits naturally under an existing heading (e.g., `# Sub Agents`, `# Preferences`, `# Questions`), place it there. If no existing section is a good fit, create a minimal new section with an appropriate heading.
- **Must**: Present the compacted text and proposed placement to the user via `questionnaire` for confirmation before writing. The questionnaire should show:
  - The compacted text
  - The target section in `AGENTS.md`
  - Options: Confirm, Edit placement, Cancel
- **Must**: After successful promotion, delete the learning file (the fact now lives in durable memory; the learning file is recoverable from git).
- **Must**: Deduplicate before writing: if the compacted text (or a semantically equivalent statement) already exists in `AGENTS.md`, skip the write and just delete the learning file.
- **Must**: All promotions are approval-gated. The system never writes to `AGENTS.md` without explicit user confirmation.
- **Must**: Promotion targets:
  - "Promote into project AGENTS.md" → `<project-root>/AGENTS.md`
  - "Promote into global AGENTS.md" → `~/.pi/agent/AGENTS.md`

### Lifecycle management

- **Must not**: Enforce capacity limits (no maximum file count per directory). The learning set is kept relevant through `/learn review`, which surfaces old or less-relevant learnings for the user to keep or delete.
- **Must not**: Implement time-based staleness rules. The previous 90-day stale flag is removed.
- **Must not**: Track occurrence counts. Promotion is user-driven via `/learn review`.
- **Must**: The `lastReviewed` frontmatter field is updated whenever a learning is touched by `/learn review` (approval, keep, consolidation, normalization) so that future reviews can sort by staleness.

### Durable memory (AGENTS.md)

- **Must**: Continue using `AGENTS.md` as the promotion target for mature learnings.
- **Must**: Promoted content is compacted into its durable essence and placed into the most fitting section (see Promotion rules above).
- **Must**: Deduplicate by checking whether the essential content already appears in `AGENTS.md`.
- **Must not**: Use an intermediate proposal queue. The `pending-memory-proposals.md` mechanism is removed. Promotions go directly from learning files to `AGENTS.md` via the review-based promotion flow.

### UI expectations

- **Must**: The learning injection block must be visible in the TUI as a collapsible message block.
- **Must**: The block must be **collapsed by default** (auto-collapsed), similar to how tool call results are rendered.
- **Must**: Support expand-on-demand so the user can inspect injected context when needed.
- **Must**: The collapsed header must show: `Memory · learnings · N refs`.
- **Should**: Use the existing `registerMessageRenderer` mechanism for custom rendering.
- **Implementation assumption**: The Pi TUI's `registerMessageRenderer` API supports controlling the initial expanded/collapsed state (e.g., via a `defaultExpanded: false` option or equivalent). If this is not currently supported, a Pi core change or workaround will be needed during implementation.

### Same-root special case

This repo (`~/.pi/agent`) is both the agent root and the project root. The system must handle this gracefully:

- Global learnings: `~/.agents/learnings/` (always at this fixed path, independent of the agent root)
- Project learnings: `<project-root>/.ai/learnings/`
- When `agentRoot === projectRoot`, both paths are valid and distinct.

### Hard-breaking replacement

- **Must**: Delete the old monolithic files on first run of the new code:
  - `.ai/learning.md`
  - `.ai/global-learning.md`
  - `.ai/pending-learnings.md`
  - `.ai/pending-memory-proposals.md`
- **Must not**: Attempt to migrate or parse records from the old files.
- **Must**: Create the new directory structure (`~/.agents/learnings/`, `<project-root>/.ai/learnings/`, and their `pending/` subdirectories) on first use.
- **Must**: Rewrite the extension code paths that referenced the old monolithic store. The old parser, renderer, and promotion-with-classification code is fully replaced.

## Interfaces & Data Contracts

### Approved learning file format

```markdown
---
created: 2026-04-14
lastReviewed: 2026-04-14
summary: "Always treat memory-derived facts as hints — validate against the live workspace before relying on them."
---

## Why

The memory system injects context snippets from `.ai/` files that may be stale or
inaccurate. Trusting them without verification leads to incorrect assumptions and
wasted effort correcting downstream mistakes.

## When to Apply

- Any time an agent action is based on a claim from injected memory context
- When memory references file paths, configuration values, or API shapes
- During implementation that depends on previously-learned constraints

## When Not to Apply

- When the learning reference is about a general principle (e.g., coding style) that
  doesn't make workspace-specific claims
- When the agent has already verified the relevant fact in the current session

## Details

The injection block includes one-line summaries from `.ai/learnings/` and
`~/.agents/learnings/`. These are derived from past sessions and may reference
files that have since changed or been deleted.

Evidence:
- extensions/memory-system/context-package.ts
- .ai/current-work.md
```

### Pending learning file format

```markdown
---
created: 2026-04-14
summary: "Prefer sub-agents for context isolation when tasks touch multiple files."
---

## Why

Delegating implementation and review work to sub-agents keeps the orchestrator
context small. Each sub-agent gets only the files and instructions it needs,
reducing confusion and token waste.

## When to Apply

- When a task involves reading or modifying more than 3–4 files
- When the orchestrator doesn't need the full detail of the delegated work
- When context isolation would prevent cross-contamination of concerns

## When Not to Apply

- Simple single-file edits where sub-agent overhead isn't justified
- When the orchestrator needs tight feedback loops with intermediate results

## Details

Discovered during review of the memory-system-demo feature implementation.
The orchestrator repeatedly hit context limits when trying to handle spec,
plan, implementation, and review in a single agent turn.

Source: review:memory-system-demo

Evidence:
- prompts/spec-plan-implement-review.md
- agents/worker.md
```

### Directory layout

```text
~/.agents/
  learnings/
    concise-questionnaire-options.md
    explicit-artifact-paths.md
    pending/
      candidate-last-review.md

<project-root>/
  .ai/
    learnings/
      validate-memory-hints.md
      sub-agent-context-isolation.md
      archive-completed-artifacts.md
      pending/
        candidate-from-analysis.md
    current-work.md
    archive/
```

### Context injection format

```text
Memory · learnings · 3 refs
Treat learning refs as hints; validate live workspace facts before relying on them.
Project (.ai/learnings):
- validate-memory-hints.md — Validate memory-derived claims against live files before relying on them.
- sub-agent-context-isolation.md — Prefer sub-agents for context isolation when tasks touch multiple files.
Global (~/.agents/learnings):
- concise-questionnaire-options.md — Keep questionnaire labels short; use descriptions for extra context.
```

### Updated `LearningsPaths` type

```typescript
interface LearningsPaths {
  globalDir: string;         // ~/.agents/learnings/
  projectDir: string;        // <project-root>/.ai/learnings/
  globalPendingDir: string;  // ~/.agents/learnings/pending/
  projectPendingDir: string; // <project-root>/.ai/learnings/pending/
}
```

### Frontmatter scanning interface

```typescript
interface ApprovedLearningFrontmatter {
  created: string;       // YYYY-MM-DD
  lastReviewed: string;  // YYYY-MM-DD
  summary: string;       // One-sentence, injected into context
}

interface PendingLearningFrontmatter {
  created: string;       // YYYY-MM-DD
  summary: string;       // One-sentence summary of the candidate
}

interface ScannedLearning {
  path: string;          // Full path to the file
  filename: string;      // e.g. "validate-memory-hints.md"
  frontmatter: ApprovedLearningFrontmatter | PendingLearningFrontmatter;
  scope: "global" | "project";
  status: "approved" | "pending";
}
```

### Filename normalization

```typescript
function slugFromSummary(summary: string): string {
  // 1. Extract 1–5 key words that capture the core idea
  //    (drop stop words, take the most meaningful content words)
  // 2. Lowercase
  // 3. Replace non-alphanumeric characters with hyphens
  // 4. Collapse consecutive hyphens
  // 5. Trim leading/trailing hyphens
  // 6. Validate: result must be 1–5 hyphen-separated words
  //    e.g. "validate-memory-hints", "sub-agent-isolation"
  // Returns the slug without .md extension
}
```

## Acceptance Criteria

- **AC1**: Given learning directories exist, when the system starts a session, then it discovers all approved learnings by scanning YAML frontmatter only, without reading file bodies.
- **AC2**: Given approved learnings exist, when the context package is built, then **all** approved learnings are injected (no selection, no token budget) using the specified injection format.
- **AC3**: Given a user runs `/learn refactor patterns`, when the analysis completes, then candidates are written directly as pending files without an approval questionnaire, and the user is asked whether to review them now.
- **AC4**: Given pending learnings exist in `pending/` directories, when a session starts, then the user is prompted to review them.
- **AC5**: Given a user approves a pending learning as "Keep as project learning" during `/learn review`, then the file is moved from `pending/` to `<project-root>/.ai/learnings/` with `lastReviewed` added to frontmatter.
- **AC6**: Given a filename collision during learning creation, when the normalized slug already exists, then the system presents the existing file and the new candidate for consolidation — no numeric suffix is created.
- **AC7**: Given a user selects "Promote into project AGENTS.md" during `/learn review`, then the learning is compacted into its durable essence, placed into the most fitting section of `<project-root>/AGENTS.md` (not blindly appended to `# Learned`), confirmed via questionnaire, and the learning file is deleted.
- **AC8**: Given a user selects "Consolidate with another" during existing-learning review, then the system presents other learnings as merge candidates, merges the selected pair, and deletes the redundant file.
- **AC9**: Given `/learn review` runs with no pending learnings and no normalization issues, then only the existing-learning review phase executes.
- **AC10**: Given memory context is injected in the TUI, then it renders as a collapsed block by default, expandable on demand, with the header `Memory · learnings · N refs`.
- **AC11**: Given a learning's summary makes a factual claim about the workspace, when the agent relies on it, then it validates the claim against live files first.
- **AC12**: Given `PI_SUBAGENT=1`, then the sub-agent receives the same learning injection as the orchestrator but does not trigger interactive learning lifecycle flows (no pending review prompts).
- **AC13**: Given the same-root case (`~/.pi/agent`), then global learnings are stored under `~/.agents/learnings/` and project learnings under `.ai/learnings/`, and both directories are scanned independently.
- **AC14**: Given the old monolithic files (`learning.md`, `global-learning.md`, `pending-learnings.md`) exist, when the new system initializes, then it deletes them without attempting migration.
- **AC15**: Given a user runs `/learn review` with existing approved learnings, then they are presented sorted by `lastReviewed` ascending, with a recommendation as the first option for each.
- **AC16**: Given the learning-analyst sub-agent runs, when it mines session artifacts, then it produces pending learning files with full body content (Why, When to Apply, When Not to Apply, Details sections).
- **AC17**: Given a learning is selected for AGENTS.md promotion, then the compacted text and proposed section placement are shown for user confirmation before any write occurs.
- **AC18**: Given a project learning is reviewed and the user selects "Promote to global learning", then the file is moved from `<project-root>/.ai/learnings/` to `~/.agents/learnings/`.
- **AC19**: Given `/learn review` encounters learning files with non-conformant filenames or frontmatter, then normalization proposals are presented in Phase 3 after existing-learning review.
- **AC20**: Given any learning file is created or normalized, then its filename contains strictly 1–5 hyphen-separated lowercase words (each token between hyphens counts as one word).

## Examples & Edge Cases

**Example: creating pending learnings (no approval needed)**
- User runs: `/learn refactor patterns`
- System invokes learning-analyst sub-agent with paths to `.ai/current-work.md`, recent reviews, and changed files.
- Learning-analyst produces 3 candidate files with full body content.
- System writes all 3 directly to `.ai/learnings/pending/`:
  - `validate-memory-hints.md`
  - `sub-agent-isolation.md`
  - `explicit-sub-agent-paths.md`
- System reports: "3 pending learnings created. Review them now?"
- User says yes → system dispatches `/learn review`.

**Example: reviewing pending learnings with recommendations**
- `/learn review` starts, finds 2 pending learnings.
- First pending learning references project-specific file paths:
  ```
  Pending: validate-memory-hints.md
  "Always treat memory-derived facts as hints — validate against the live workspace."

  Options:
  → Keep as project learning (recommended)
    Keep as global learning
    Promote into project AGENTS.md
    Promote into global AGENTS.md
    Reject
  ```
- User accepts the recommendation → file moves to `.ai/learnings/`, `lastReviewed` added.
- Second pending learning is a general pattern:
  ```
  Pending: concise-questionnaire-options.md
  "Keep questionnaire labels short; use descriptions for extra context."

  Options:
  → Keep as global learning (recommended)
    Keep as project learning
    Promote into project AGENTS.md
    Promote into global AGENTS.md
    Reject
  ```
- User accepts → file moves to `~/.agents/learnings/`, `lastReviewed` added.

**Example: promoting a learning to AGENTS.md (smart placement)**
- During `/learn review`, user selects "Promote into project AGENTS.md" for a learning about sub-agent delegation.
- Learning file body contains detailed rationale about context isolation, evidence from specific sessions, and file path references.
- System compacts to: `Delegate multi-file tasks to sub-agents for context isolation; pass explicit artifact paths.`
- System analyzes `<project-root>/AGENTS.md`, finds `# Sub Agents` section exists.
- System presents:
  ```
  Promote to AGENTS.md:
  Text: "Delegate multi-file tasks to sub-agents for context isolation; pass explicit artifact paths."
  Section: # Sub Agents

  Options:
  → Confirm
    Edit placement
    Cancel
  ```
- User confirms → system adds the bullet under `# Sub Agents`, deletes the learning file.

**Example: promoting to global learning (scope change)**
- During `/learn review`, a project learning `explicit-sub-agent-paths.md` is presented.
- System recommends "Promote to global learning" because the pattern is not project-specific.
- User selects it → file is moved from `<project-root>/.ai/learnings/` to `~/.agents/learnings/`, `lastReviewed` updated.

**Example: consolidating learnings during review**
- During existing-learning review, user sees `validate-memory-hints.md` and recognizes overlap with `check-workspace-memory.md`.
- User selects "Consolidate with another".
- System presents other learnings as merge candidates; user picks `check-workspace-memory.md`.
- System merges the two bodies, keeps the more descriptive summary, writes the merged result to the first file, deletes the second.

**Example: filename collision triggers consolidation**
- During `/learn [focus]`, learning-analyst produces a candidate with summary "Validate memory hints before relying on them".
- Slug normalizes to `validate-memory-hints`; `validate-memory-hints.md` already exists in `pending/`.
- System shows the existing file's summary alongside the new candidate.
- User selects "Merge" — system incorporates the new content into the existing pending file.

**Edge case: sub-agent receives injection**
- Orchestrator delegates a task to a sub-agent.
- Sub-agent receives the same `Memory · learnings · N refs` block.
- Sub-agent does NOT get prompted about pending learnings.

**Edge case: old monolithic files present**
- `.ai/learning.md` exists from the old system.
- On first run, the new system deletes it and creates `.ai/learnings/` if it doesn't exist.

**Edge case: "Promote to global learning" not shown for global learnings**
- When reviewing a learning already in `~/.agents/learnings/`, the "Promote to global learning" option is not shown (it's already global). Only keep, AGENTS.md promotions, remove, and consolidate are shown.

**Edge case: normalization catches long filenames**
- Phase 3 finds `use-explicit-paths-in-tasks.md` (5 words — passes). But finds `validate-memory-hints-before-relying-on-them.md` (7 words — fails). System proposes renaming to `validate-memory-hints.md` and presents via questionnaire before applying.

## Dependencies

- **Pi extension API** — `registerMessageRenderer`, `registerTool`, `registerCommand`, extension hooks (`session_start`, `before_agent_start`, etc.).
- **Pi TUI** — collapsed/expandable custom message rendering (see implementation assumption in UI section).
- **`questionnaire` tool** — for all review and promotion flows.
- **Sub-agent system** — for delegating analysis to `learning-analyst`, and for injecting learnings into sub-agent context.
- **File system** — `readdir`, `readFile`, `writeFile`, `rename`, `unlink`, `mkdir`.
- **YAML parser** — for frontmatter extraction. Use a lightweight parser or regex-based extraction.
- **Git** — for mining recent changes during automated pending-learning creation, and for audit trail on deletions.

## Rationale & Context

### Why creation mode doesn't need approval

The creation-to-pending path should be frictionless. Pending files are just candidates — they have no effect on agent behavior until approved. Requiring approval to write a pending file adds a questionnaire step that slows discovery without adding value: the user still reviews everything during `/learn review`. This separates "gather" (creation) from "curate" (review) cleanly.

### Why merge consolidate, cleanup, and promote into review

Three separate commands (`/learn consolidate`, `/learn cleanup`, `/learn promote`) fragment what is fundamentally one curation activity: looking at learnings and deciding what to do with them. Merging them into `/learn review` means one command does all curation, the user sees each learning once with all available actions, and there's no need to remember which sub-command handles which operation. The three-phase structure within review (pending → existing → normalization) keeps the flow organized without requiring separate entry points.

### Why recommendations come first

When the system has enough context to suggest an action, showing the recommendation as the first option reduces cognitive load. The user can accept with minimal effort or override by selecting another option. This follows the principle of sensible defaults: make the common case fast, keep all options available.

### Why smart placement in AGENTS.md instead of a generic section

A `# Learned` dumping ground creates an unstructured list that grows without organization. AGENTS.md already has meaningful sections (e.g., `# Preferences`, `# Sub Agents`, `# Questions`). Placing promoted content into the fitting section keeps AGENTS.md coherent and readable. The compaction step ensures that evidence, rationale, and situational detail are stripped — only the durable directive enters AGENTS.md.

### Why remove IDs?

IDs (`L0001`, `P0001`) added complexity to filenames, frontmatter, and lifecycle operations without providing a benefit that filenames don't already cover. Nothing references learnings by ID externally. The filename (1–5 word slug) is a human-readable, unique-enough identifier.

### Why strict 1–5 word filenames?

Short slugs are scannable at a glance in directory listings and injection blocks. Longer slugs (6+ words) start reading like sentences and lose the "label" quality. The 5-word cap forces distillation to the core concept, which also improves collision detection — two learnings about the same topic are more likely to collide when slugs are short. If a concept can't be captured in 5 words, that's a signal to sharpen the learning's focus.

### Why collisions trigger consolidation instead of suffixes?

A collision means two learnings are about the same topic. That's a signal to merge, not to create a parallel file. Numeric suffixes (`-2`, `-3`) obscure this signal and lead to fragmentation. Forcing consolidation keeps the learning set clean and non-redundant.

### Why remove classification?

The five-way category system (`mistake-pattern`, `successful-tactic`, `user-preference`, `convention-discovery`, `tool-usage-pattern`) added complexity without measurable retrieval benefit. Learnings are matched by summary content, not category. Removing it simplifies frontmatter, the approval questionnaire, the learning-analyst prompt, and the promotion logic.

### Why inject all approved learnings?

With no token budget or selection logic, the injection is simpler and deterministic. The trade-off is that the learning set must be kept small and relevant — but that's exactly what `/learn review` provides. The user curates the set; the system injects all of it. This removes ranking logic, keyword matching, and the "why wasn't my learning injected?" confusion.

### Why no capacity limits?

A hard cap (e.g., 30 files) is arbitrary and creates friction at the boundary. The real lifecycle mechanism is `/learn review`, where the user periodically evaluates whether each learning is still relevant. Old or low-value learnings get deleted; valuable ones get promoted to AGENTS.md. The set stays small because the user actively manages it, not because a number blocks new additions.

### Why `created` and `lastReviewed` instead of `date` and `confidence`?

`created` records when the learning was first established. `lastReviewed` tracks when the user last confirmed it's still relevant, enabling `/learn review` to sort by staleness. `confidence` was a subjective label that didn't drive any system behavior after the ranking/budget removal — it's noise in the frontmatter.

### Why no `source` in pending frontmatter?

Source metadata (which review, which session, which analysis run produced the candidate) is useful context but not a scanning/filtering field. Putting it in the body (e.g., in `## Details` or a `## Source` line) keeps frontmatter minimal and puts trust/provenance context where it belongs — in the narrative that the user reads during review.

### Why sub-agents get injection?

The injection block is lightweight: one line per learning (filename + summary). Even with 20 learnings, this is ~40 lines / ~2K tokens — negligible in a sub-agent context window. The benefit is that sub-agents respect the same learned patterns as the orchestrator without needing explicit instruction forwarding.

### Why one file per learning?

The monolithic `learning.md` file required a custom Markdown parser. One-file-per-learning:
- Enables filesystem-based scanning (frontmatter only, no body parse needed)
- Makes individual learnings independently editable by humans and tools
- Simplifies create, update, delete operations (file operations instead of in-file surgery)
- Follows the progressive disclosure model: frontmatter is the summary, body is the detail

### Why no index file?

An index file would be redundant with the filesystem. Directory listing plus frontmatter scanning provides the same information without a synchronization problem.

### Why no archive handling?

Git history already provides full provenance. Deletion is simple, and `git log --diff-filter=D -- .ai/learnings/` recovers anything needed.

### Why hard-breaking replacement?

The old monolithic format has no forward value. Migrating records would require parsing the old format, mapping fields to the new schema, and handling edge cases — all for a handful of records that can be re-discovered organically. A clean break is simpler and avoids carrying legacy parsing code.

### Pending memory proposals removal

The `pending-memory-proposals.md` mechanism is removed because promotions are now direct: the `/learn review` flow reads a learning file and writes to `AGENTS.md` on user approval. No intermediate proposal queue is needed.

## Implementation Assumptions

These are not user-facing questions but technical assumptions to verify during implementation:

1. **TUI collapsed-by-default rendering**: The spec assumes `registerMessageRenderer` supports controlling the initial expanded/collapsed state (e.g., via a `defaultExpanded: false` option). If the current Pi TUI API does not support this, a core change or workaround will be needed.
2. **Learning-analyst sub-agent**: The spec assumes the learning-analyst can receive session context (conversation history, recent tool calls) as input. The exact mechanism for passing session context to a sub-agent needs verification during implementation.
3. **Slug generation**: The strict 1–5 word slug extraction from a summary sentence requires distilling to the most meaningful content words. This may use a simple heuristic (drop stop words, take the top content words) or could be done by the LLM during the creation flow. The exact implementation is left to the plan, but the output **must** be validated to contain no more than 5 hyphen-separated tokens.
4. **AGENTS.md section analysis**: The smart placement logic for promotion assumes the agent can analyze AGENTS.md structure and identify the most fitting section. This is LLM-driven — the compaction and placement are done by the agent (not a deterministic algorithm), confirmed by the user.

## Open Questions

No open questions — specification is complete.

## References

- Current work anchor: `.ai/current-work.md`
- Historical spec: `.ai/archive/2026-04-14-self-learning-loop-agent-harness-spec.md`
- Current extension: `extensions/memory-system/`
- Current learning store: `extensions/memory-system/learnings.ts`
- Current promotion logic: `extensions/memory-system/promotions.ts`
- Pi extension docs: `~/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Project-memory skill: `~/.agents/skills/project-memory/SKILL.md`
