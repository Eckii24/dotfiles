# Learning System

The learning system is the repo’s runtime-backed memory pipeline for **capturing**, **reviewing**, **normalizing**, **injecting**, and **promoting** learnings.

It replaces the old monolithic memory files with a **one-file-per-learning** model and connects four layers:

1. **Storage and path resolution** — where learnings live and how files are validated
2. **Runtime tools** — the live APIs used by the learn skill and learning agents
3. **Skill + agent orchestration** — the `learn` skill plus the `learn-orchestrator` split between creation and review
4. **Context injection** — lightweight learning refs injected into the orchestrator and sub-agents

Primary source files:

- `extensions/learning-system/index.ts`
- `extensions/learning-system/runtime.ts`
- `extensions/learning-system/store.ts`
- `extensions/learning-system/review.ts`
- `extensions/learning-system/promotion.ts`
- `extensions/learning-system/paths.ts`
- `extensions/learning-system/scan.ts`
- `extensions/learning-system/markdown.ts`
- `skills/learn/SKILL.md`
- `agents/learn-orchestrator.md`

---

## What the extension is responsible for

Code: `extensions/learning-system/index.ts`, `extensions/learning-system/runtime.ts`

The extension does all of the following:

- resolves the active **project root** and the managed learning directories
- creates the learning directories on first use
- creates and scans the managed learning stores without any legacy migration/cleanup step
- scans approved learnings and injects them into context as **refs only** (`filename + summary`)
- prompts the user to run `/skill:learn review` when pending learnings exist
- exposes runtime-backed tools so skill and agent flows use the same logic as the extension implementation
- refreshes injected learnings after `/skill:learn ...` changes the live store
- keeps sub-agents synchronized with the same learning refs, but without the interactive review prompt

This means the prompt layer does **not** manually invent its own storage or file naming rules. It delegates to the runtime.

Operational boundary:

- direct file creation is acceptable only for **pending** learnings when the runtime tool is unavailable
- approved learnings should enter or change state only through the `/skill:learn review` runtime actions

---

## High-level architecture

### 1. Path and root resolution

Code: `extensions/learning-system/paths.ts`

`resolveLearningSystemPaths()` computes all managed paths from the current `cwd`.

It resolves:

- `agentRoot`
- `projectRoot`
- `sameRoot`
- `projectAiDir`
- `globalLearningsRoot`
- `globalDir`
- `projectDir`
- `globalPendingDir`
- `projectPendingDir`
- `globalAgentsPath`
- `projectAgentsPath`

Project root resolution is intentional:

1. if Pi is running inside the agent root, the agent root is treated as the project root
2. otherwise, if `git rev-parse --show-toplevel` works, the git root wins
3. otherwise, the runtime walks upward until it finds `.ai/` or `AGENTS.md`
4. otherwise, it falls back to the current `cwd`

That logic is why the extension behaves correctly both for normal repos and for the special “agent root is also the project root” case.

### 2. Storage and normalization

Code: `extensions/learning-system/store.ts`, `extensions/learning-system/markdown.ts`

This layer is responsible for:

- generating canonical slugs from summaries
- reading/writing learning documents
- normalizing frontmatter and body structure
- approving pending learnings
- moving approved learnings across scopes
- renaming/deleting learning files
- detecting slug collisions

### 3. Review and curation

Code: `extensions/learning-system/review.ts`

This layer provides:

- sort order for review
- merge logic for consolidating two learnings
- normalization detection and normalization application

### 4. Promotion into AGENTS.md

Code: `extensions/learning-system/promotion.ts`

This layer:

- compacts a full learning into a short durable directive
- accepts a caller-chosen AGENTS section and otherwise defaults placement to `Learnings`
- detects duplicate directives in normalized form
- creates a preview-consistency token for promotion safety
- inserts the final bullet into `AGENTS.md`

### 5. Runtime API and skill integration

Code: `extensions/learning-system/runtime.ts`, `skills/learn/SKILL.md`

The runtime wraps all storage/review/promotion logic behind explicit tools such as:

- `learning_write_pending`
- `learning_scan`
- `learning_promotion_preview`
- `learning_apply_review_action`

The `learn` skill and its helper agents use these tools as the canonical interface.

### 6. Context injection and UI behavior

Code: `extensions/learning-system/index.ts`, `extensions/learning-system/inject.ts`

This layer:

- builds the injected “Memory · learnings” block
- renders it as a custom TUI message
- injects it into the main orchestrator and sub-agents
- deduplicates stale copies in context by hash
- refreshes it after `/skill:learn ...` mutates the learning store

---

## Storage layout

Code: `extensions/learning-system/paths.ts`

The runtime uses these locations:

```text
~/.agents/
  learnings/
    *.md
    pending/
      *.md

<project-root>/
  .ai/
    learnings/
      *.md
      pending/
        *.md

<project-root>/AGENTS.md
~/.pi/agent/AGENTS.md
```

Meaning:

- **Approved project learnings** live in `<project-root>/.ai/learnings/*.md`
- **Pending project learnings** live in `<project-root>/.ai/learnings/pending/*.md`
- **Approved global learnings** live in `~/.agents/learnings/*.md`
- **Pending global learnings** live in `~/.agents/learnings/pending/*.md`
- **Project AGENTS target** is `<project-root>/AGENTS.md`
- **Global AGENTS target** is `~/.pi/agent/AGENTS.md`

### Same-root nuance

Code: `extensions/learning-system/paths.ts`, `extensions/learning-system/README.md`

If this repo is both the Pi agent root and the project root, the storage is still split:

- project learnings stay under `.ai/learnings/`
- global learnings stay under `~/.agents/learnings/`
- project AGENTS stays at `<project-root>/AGENTS.md`
- global AGENTS stays at `~/.pi/agent/AGENTS.md`

So “same root” changes path resolution, **not** the storage model.

---

## Learning file format

Code: `extensions/learning-system/contracts.ts`, `extensions/learning-system/markdown.ts`, `skills/learn/SKILL.md`

The system has exactly two persisted learning states: `pending` and `approved`.

### Pending learning format

Pending learnings are candidates waiting for review.

```md
---
created: "2026-04-15"
summary: "Validate memory-derived claims against live workspace files before relying on them."
---

## Why

This learning matters because validate memory-derived claims against live workspace files before relying on them.

## When to Apply

Apply this when the same pattern or decision point appears again.

## When Not to Apply

[optional]

## Details

[evidence, file paths, examples, rationale]
```

Required frontmatter keys for pending files:

- `created`
- `summary`

### Approved learning format

Approved learnings are the only learnings injected into context.

```md
---
created: "2026-04-15"
lastReviewed: "2026-04-15"
summary: "Validate memory-derived claims against live workspace files before relying on them."
---

## Why

This learning matters because validate memory-derived claims against live workspace files before relying on them.

## When to Apply

Apply this when the same pattern or decision point appears again.

## When Not to Apply

[optional]

## Details

[evidence, file paths, examples, rationale]
```

Required frontmatter keys for approved files:

- `created`
- `lastReviewed`
- `summary`

### Body structure rules

Code: `extensions/learning-system/markdown.ts`

The canonical body template is:

```md
## Why

[Why this learning matters.]

## When to Apply

[Concrete triggers or situations.]

## When Not to Apply

[Where the learning does not apply.]

## Details

[Evidence, file paths, examples, rationale.]
```

Important behavior:

- if the file body is missing sections, `ensureStructuredLearningBody()` reconstructs them
- `Why` and `When to Apply` are the minimum structured shape the system wants to preserve
- freeform body text is folded into `Details` when a learning is normalized

---

## Slugging and filenames

Code: `extensions/learning-system/store.ts`

Filenames are canonical slugs derived from the summary.

Rules:

- lowercase
- hyphenated
- 1–5 words
- no IDs
- no numeric suffixes
- collisions are treated as consolidation signals, not “make up another filename” signals

Examples:

- `validate-memory-hints.md`
- `compact-questionnaire-options.md`
- `delegate-current-work-context.md`

The slugger is not a trivial `kebab-case(summary)` transform. It:

- tokenizes the summary
- removes stop words and low-signal words
- prefers directive anchors like `validate`, `delegate`, `prefer`, `keep`, `review`, `merge`, `promote`
- preserves special bigrams such as `sub-agents` and `current-work`
- chooses a short, directive-heavy canonical filename

That keeps filenames compact and reviewable.

---

## What gets injected into context

Code: `extensions/learning-system/inject.ts`, `extensions/learning-system/index.ts`

Only **approved** learnings are injected, and only as **refs**.

Injected block format:

```text
Memory · learnings · N refs
Treat learning refs as hints; validate live workspace facts before relying on them.
Project (.ai/learnings):
- validate-memory-hints.md — Validate memory-derived claims against live files before relying on them.
Global (~/.agents/learnings):
- concise-questionnaire-options.md — Keep questionnaire labels short; use descriptions for extra context.
```

Important constraints:

- the body of the learning is **not** injected
- the injected text is intentionally lightweight
- the block is a hint layer, not a source of truth
- agents are expected to re-check live workspace facts before acting on a learning

### Why refs instead of full bodies?

Because the system wants:

- low token cost
- durable context reminders
- on-demand deeper reads only when needed
- fewer stale details in the live prompt context

---

## Session lifecycle and UI behavior

Code: `extensions/learning-system/index.ts`

### On `session_start`

The extension:

1. initializes directories if needed
2. scans approved learnings
3. builds the injection block
4. optionally prompts the user to review pending learnings
5. sends the visible custom learning message into the session

The pending-review prompt only appears when:

- Pi has a UI
- the process is **not** a sub-agent
- there is at least one pending learning
- the start reason is not `reload`

### On `before_agent_start`

The extension injects the same learning block into the upcoming agent turn, but with `display: false` so it participates in context without creating noisy duplicate UI rows.

### On `context`

The extension deduplicates old learning-system custom messages and keeps only the latest one with the current hash.

### On `agent_end`

If the last top-level command started with `/skill:learn`, the extension refreshes the live scan and re-sends the newest learning injection.

### Custom TUI rendering

Code: `extensions/learning-system/index.ts`

The learning block is rendered via a custom message renderer. In collapsed mode it shows the header only; in expanded mode it shows the full injected content.

---

## `/skill:learn` is the canonical workflow

Code: `skills/learn/SKILL.md`

`/skill:learn` has exactly two modes:

1. `/skill:learn [focus]` — creation mode
2. `/skill:learn review` — review/curation mode

There are no separate slash commands for “cleanup”, “normalize”, or “promote”. Those are all part of `/skill:learn review`.

---

## Workflow 1 — `/skill:learn [focus]` creation flow

Code: `skills/learn/SKILL.md`, `agents/learn-orchestrator.md`, `extensions/learning-system/runtime.ts`

This flow starts in the `learn` skill, while automatic creation-mode execution should usually be delegated to `agents/learn-orchestrator.md`, which uses `skills/learn/SKILL.md` plus the learning runtime to persist candidates.

### Step-by-step data flow

1. **Read current work and artifacts**
   - The prompt reads `.ai/current-work.md` when present.
   - It gathers additional evidence such as review/spec/plan docs, changed files, and an explicitly available session transcript path.
   - Review artifacts should be treated as cumulative ledgers, so resolved findings are still valid learning evidence.
   - Source: `skills/learn/SKILL.md`

2. **Delegate creation-mode orchestration**
   - The calling workflow should prefer `agents/learn-orchestrator.md` for creation mode.
   - That agent reads `skills/learn/SKILL.md`, mines candidates directly from the provided evidence, and may use optional narrow nested sub-agents only for session-transcript or broad changed-file summarization when the evidence set is unusually broad.
   - Source: `skills/learn/SKILL.md`, `agents/learn-orchestrator.md`

3. **Write pending learnings immediately**
   - Creation mode does **not** ask for pre-approval before writing pending candidates.
   - The delegated agent should use `learning_write_pending` instead of direct file writes.
   - Source: `skills/learn/SKILL.md`, `extensions/learning-system/runtime.ts`

4. **Handle slug collisions in the caller**
   - `learning_write_pending` checks both pending and approved learnings in the relevant scope.
   - If the canonical slug already exists, the delegated agent returns the unresolved collision to the caller.
   - The top-level prompt asks the user whether to Merge, Replace, or Skip, then applies that decision with `learning_resolve_collision`.
   - Source: `skills/learn/SKILL.md`, `skills/learn/SKILL.md`, `extensions/learning-system/store.ts`, `extensions/learning-system/runtime.ts`

5. **Report exact created files**
   - The prompt reports the created pending learning paths.
   - Then it asks whether to continue directly into `/skill:learn review`.
   - Source: `skills/learn/SKILL.md`

### Why creation writes directly to pending files

Because pending learnings are the incubation layer. The system wants a durable queue first and a curation pass second.

---

## Workflow 2 — `/skill:learn review`

Code: `skills/learn/SKILL.md`, `extensions/learning-system/runtime.ts`, `extensions/learning-system/review.ts`

`/skill:learn review` is the single curation flow and runs in **three phases**.

### Phase 1 — Pending review

1. The skill starts with `learning_scan`.
2. The runtime returns recommendation-free normalized scan results:
   - pending learnings
   - approved learnings
   - normalization issues
3. Pending items are reviewed one by one with `questionnaire`.
4. The skill derives the recommendation heuristically from the scanned facts and presents it as the first option.
5. The chosen decision is applied with `learning_apply_review_action`.

Possible outcomes for pending items:

- keep as project learning → approve into project scope
- keep as global learning → approve into global scope
- promote directly into project AGENTS.md
- promote directly into global AGENTS.md
- reject

Important nuance:

- promotion can happen directly from a pending file
- the pending file does **not** need to become an approved learning first
- for preview/promotion, the runtime converts the pending document into an approved in-memory representation

### Phase 2 — Existing approved-learning review

Approved items are reviewed after pending items, optionally.

The review queue sorts approved learnings by:

- oldest `lastReviewed` first
- then filename

Possible decisions:

- keep
- move project learning to global scope
- promote into project AGENTS.md
- promote into global AGENTS.md
- remove
- consolidate with another approved learning

### Phase 3 — Normalization review

After phases 1 and 2, the skill re-runs `learning_scan` so phase 3 looks at the **remaining live state**.

Normalization checks detect:

- invalid filenames
- extra/missing frontmatter fields
- malformed or unstructured bodies

The skill presents fixes via `questionnaire`, then applies approved normalizations with `learning_apply_review_action(action: "normalize")`.

---

## Review heuristics and recommendations

Code: `skills/learn/SKILL.md`

The runtime no longer returns recommendations. The `learn` skill derives them from recommendation-free scan results.

### Pending recommendation heuristic

The skill should generally recommend:

- **Keep as project learning** for project-specific file paths or repo details
- **Keep as global learning** for broadly reusable directive-style guidance with no obvious project coupling
- promotion into `AGENTS.md` only for exceptionally stable, high-signal guidance
- **Keep as project learning** as the default fallback

### Existing approved recommendation heuristic

The skill should generally recommend:

- **Keep** for items reviewed within 30 days
- promotion into `AGENTS.md` for old, stable, directive-style guidance
- **Promote to global learning** for project learnings that look broadly reusable
- **Remove** for low-value or redundant items
- normalization/keep over blind deletion when malformed content may still be salvageable

These are recommendations only; the skill still asks the user via `questionnaire`.

---

## Collision handling

Code: `extensions/learning-system/store.ts`, `extensions/learning-system/runtime.ts`, `skills/learn/SKILL.md`

The learning system treats slug collisions as **consolidation events**, not as a signal to generate suffixed filenames.

### Creation-time collisions

Triggered by `learning_write_pending`.

Resolution tool:

- `learning_resolve_collision` with `mode: "pending_creation"`

Actions:

- `merge`
- `replace`
- `skip`

### Review-time collisions

Triggered by `learning_apply_review_action` when approving, moving, or normalizing would land on an existing slug.

Resolution tool:

- `learning_resolve_collision` with `mode: "review"`

Actions:

- `merge`
- `replace`
- `skip`
- `keep_current_filename` (normalization-only case)

This is a core invariant: **no numeric suffixes and no duplicate canonical lessons with different filenames**.

---

## Normalization rules

Code: `extensions/learning-system/review.ts`, `extensions/learning-system/markdown.ts`, `extensions/learning-system/store.ts`

Normalization enforces three things:

1. **Filename**
   - must be a valid 1–5 word lowercase hyphenated slug

2. **Frontmatter**
   - pending files: exactly `created`, `summary`
   - approved files: exactly `created`, `lastReviewed`, `summary`

3. **Body**
   - must have the structured sections
   - freeform body text is converted into canonical sections

If the normalized filename collides, the runtime reports a collision instead of inventing a new filename.

---

## Consolidation / merge behavior

Code: `extensions/learning-system/review.ts`

When two approved learnings are consolidated:

- the earlier `created` date is preserved
- `lastReviewed` is updated to the review date
- the longer summary usually wins
- sections are merged block-by-block
- duplicate blocks are removed by normalized content
- the secondary learning file is deleted

Section merge order:

- `Why`
- `When to Apply`
- `When Not to Apply`
- `Details`

---

## Promotion into `AGENTS.md`

Code: `extensions/learning-system/promotion.ts`, `extensions/learning-system/runtime.ts`, `skills/learn/SKILL.md`

Promotion is the final “turn this learning into durable operating guidance” step.

### Promotion flow

1. The skill calls `learning_promotion_preview`.
2. The runtime reads the learning file.
3. The learning is compacted into a short directive sentence.
4. The prompt/user chooses the target AGENTS section semantically; the runtime uses that section or defaults to `Learnings`.
5. A preview-consistency token is generated.
6. The prompt shows the preview to the user.
7. The prompt is responsible for the explicit user-approval step via `questionnaire`.
8. After the user confirms, the skill calls `learning_apply_review_action(action: "promote")` with the matching token.
9. The runtime writes to `AGENTS.md` and deletes the source learning file.

### Why the confirmation token exists

The token is a preview-consistency guard, not an independent proof of user approval. Its job is to prevent a stale preview from being applied after the user edits placement or text. If the preview changes, a new token is required.

### How compaction works

`compactLearning()` builds a concise durable bullet from:

- the learning summary
- `When to Apply`
- optionally `When Not to Apply`
- or the first sentence of `Why` when needed

Result style example:

```text
Validate memory-derived claims against live workspace files before relying on them. Apply when a decision depends on remembered repo facts. Do not apply when the user already pointed at the live source file.
```

### Section placement

Section choice is prompt-owned, not keyword-matched in runtime code.

The recommended flow is:

- read the target `AGENTS.md`
- choose the best existing section semantically
- pass `sectionHeading` into `learning_promotion_preview` when needed
- fall back to `Learnings` if no existing section is a clear fit

### Duplicate detection

Promotion uses normalized text dedupe, not literal-string dedupe only.

If the compacted directive is already present in normalized form:

- no new AGENTS bullet is written
- the learning file is still deleted as already-consumed guidance

---

## Runtime-backed tools

Code: `extensions/learning-system/runtime.ts`

These tools are the public runtime interface used by skill and agent flows.

| Tool | Purpose |
|---|---|
| `learning_write_pending` | Create a pending learning with canonical slugging, body normalization, and collision detection |
| `learning_resolve_collision` | Resolve a pending-creation or review-time collision via merge, replace, skip, or keep-current-filename |
| `learning_scan` | Return normalized pending items, normalized approved items, and normalization proposals in live review order |
| `learning_promotion_preview` | Build the AGENTS preview, selected section, dedupe signal, and preview-consistency token |
| `learning_apply_review_action` | Apply approve/reject/keep/move/promote/remove/consolidate/normalize actions |

### Safety checks inside the runtime

The runtime refuses to operate on arbitrary paths.

`paths.ts` guards that:

- learning file paths stay under managed learning roots
- AGENTS mutations only target the managed project/global `AGENTS.md`
- only `.md` learning files are accepted

This is important because prompt code passes file paths around as tool parameters.

---

## How prompts, agents, and sub-agents fit together

### The `learn` skill is the canonical learning workflow entrypoint

Code: `skills/learn/SKILL.md`

The skill owns the caller-facing workflow shape:

- gather evidence and caller-owned artifact paths
- delegate creation mode to `learn-orchestrator` when possible
- ask review questions with `questionnaire`
- handle unresolved collisions and promotion confirmation
- call runtime tools to make final state changes

### `learn-orchestrator` owns creation-mode execution

Code: `agents/learn-orchestrator.md`, `skills/learn/SKILL.md`

The learn orchestrator:

- keeps its own instructions lean
- mines candidates directly from current-work, review, spec/plan, changed-file, and session evidence
- may use bounded nested sub-agents only when the evidence set is unusually broad
- writes pending learnings through the runtime
- returns unresolved collisions to the caller instead of making questionnaire-owned decisions itself

### Other prompts hand off into learning creation explicitly

Code:

- `prompts/implement-review.md`
- `prompts/plan-implement-review.md`
- `prompts/spec-plan-implement-review.md`
- `prompts/plan.md`
- `prompts/spec-plan.md`

These workflows should hand off explicitly to `learn-orchestrator` for post-implementation learning creation instead of relying on vague prompt-to-prompt dispatch, while `/skill:learn review` remains the canonical interactive curation flow.

### Sub-agents also receive learning refs

Code: `extensions/learning-system/index.ts`

The extension injects the same approved-learning refs into sub-agents via `before_agent_start`, but sub-agents do **not** trigger the pending-review UI prompt. That keeps background work deterministic and non-interactive.

---

## Fast scan vs full read

Code: `extensions/learning-system/scan.ts`, `extensions/learning-system/store.ts`

The system uses two different read patterns on purpose:

- `scan.ts` reads **frontmatter only** for fast startup and injection building
- `store.ts` reads full documents when review, normalization, merge, or promotion needs the body

That separation keeps normal startup cheap while still allowing rich review behavior.

---

## Important invariants

These are the rules the whole system is built around.

1. **Approved learnings only are injected**
   - Source: `extensions/learning-system/inject.ts`

2. **Injected content is refs only, not full bodies**
   - Source: `extensions/learning-system/inject.ts`, `skills/learn/SKILL.md`

3. **Collisions are consolidation signals**
   - Source: `extensions/learning-system/store.ts`, `skills/learn/SKILL.md`

4. **Canonical filenames stay short and stable**
   - Source: `extensions/learning-system/store.ts`

5. **Bodies should stay structured**
   - Source: `extensions/learning-system/markdown.ts`

6. **Promotion requires a fresh preview-consistency token**
   - Source: `extensions/learning-system/runtime.ts`, `extensions/learning-system/promotion.ts`

7. **AGENTS writes are restricted to managed targets**
   - Source: `extensions/learning-system/paths.ts`

8. **Memory refs are hints, not truth**
   - Source: `extensions/learning-system/inject.ts`, `skills/learn/SKILL.md`

9. **The live runtime is the source of truth for learn-skill mutations**
   - Source: `extensions/learning-system/runtime.ts`

---

## Edge cases worth knowing

### Pending learnings can skip approved storage and go straight to AGENTS

Code: `extensions/learning-system/runtime.ts`

A pending learning can be promoted directly during review. The runtime converts it to an approved in-memory document for preview/promotion, writes the AGENTS entry, then deletes the pending file.

### Normalization can rename a file

Code: `extensions/learning-system/review.ts`

Normalization may both rewrite the body/frontmatter **and** rename the file if the current slug is not canonical.

### Normalization can also hit collisions

Code: `extensions/learning-system/review.ts`, `extensions/learning-system/runtime.ts`

If the normalized canonical filename already exists, the runtime reports a collision instead of renaming automatically.

### Review recommendations are heuristic, not hard policy

Code: `skills/learn/SKILL.md`

The `learn` skill derives recommended actions from recommendation-free scan results, but still asks the user via `questionnaire`.

### Old injected learning messages are removed from context

Code: `extensions/learning-system/index.ts`

The `context` hook filters out stale learning-system custom messages and keeps only the current one.

---

## Operational command

Code: `extensions/learning-system/index.ts`

The extension registers:

- `/learning-status`

It prints:

- resolved project/global paths
- same-root status
- approved ref count
- pending count
- the currently injected learning block

That command is useful for debugging path resolution and queue state.

---

## End-to-end example

### Example 1 — creation

1. User runs `/skill:learn guardrails-integration`
2. `skills/learn/SKILL.md` gathers `.ai/current-work.md`, changed files, mentioned files, and any explicitly available review/session artifacts
3. The workflow delegates creation mode to `agents/learn-orchestrator.md`
4. `learn-orchestrator` uses `skills/learn/SKILL.md`, mines candidates directly from the provided evidence, and writes pending learnings with `learning_write_pending`
5. Any unresolved slug collisions are handed back to the top-level prompt for questionnaire-driven resolution
6. Pending files land in `.ai/learnings/pending/*.md`
7. The user is asked whether to review now

### Example 2 — review and promotion

1. User runs `/skill:learn review`
2. The skill starts with `learning_scan`
3. User chooses “Promote into project AGENTS.md” for a candidate
4. The skill calls `learning_promotion_preview`
5. The runtime returns:
   - target AGENTS path
   - section heading
   - compacted text
   - dedupe status
   - preview-consistency token
6. The skill obtains explicit user confirmation via `questionnaire`
7. The skill calls `learning_apply_review_action(action: "promote", confirmationToken: ...)`
8. The runtime writes the AGENTS bullet and deletes the learning file
9. The extension refreshes the injected learning refs

---

## If you need to modify this system

Start with these files in this order:

1. `skills/learn/SKILL.md` — workflow contract
2. `extensions/learning-system/runtime.ts` — tool/runtime behavior
3. `extensions/learning-system/store.ts` — file creation/move/collision logic
4. `extensions/learning-system/review.ts` — heuristics, normalization, merge behavior
5. `extensions/learning-system/promotion.ts` — AGENTS placement and token flow
6. `extensions/learning-system/index.ts` — injection and UI wiring
7. `agents/learn-orchestrator.md` — lean creation-mode worker contract

That order matches the real dependency chain: prompt contract -> runtime API -> persistence/review rules -> UI injection.
