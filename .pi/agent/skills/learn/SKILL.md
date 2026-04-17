---
name: learn
description: Orchestrate learning extraction and interactive learning review. Use when you need to mine `.ai/current-work.md`, review artifacts, changed files, or an explicitly provided session path for candidate learnings, create pending learnings, or review pending/approved learnings with questionnaire-driven decisions.
---

# Learn

This skill is the canonical learning workflow.

Use it in exactly two modes:
- **Creation mode** — when the user input is anything other than `review`
- **Review mode** — when the user input is exactly `review`

When this skill is used through `learn-orchestrator`, default to **creation mode** unless the caller explicitly asks for review.

## Core model
- Approved project learnings live in `<project-root>/.ai/learnings/*.md`.
- Pending project learnings live in `<project-root>/.ai/learnings/pending/*.md`.
- Approved global learnings live in `~/.agents/learnings/*.md`.
- Pending global learnings live in `~/.agents/learnings/pending/*.md`.
- Approved learnings inject only `filename + summary` into context. Bodies remain on-demand.
- Treat learning refs as hints; validate live workspace facts before relying on them.

## General evidence rules
- Read `.ai/current-work.md` when it exists.
- Prefer explicit `Learning candidates`, `Pitfalls & surprises`, `Failed attempts / rejected options`, and `Review findings & fixes` first.
- Treat `.ai/<slug>-review.md` artifacts as **cumulative ledgers**. Resolved findings still count as learning evidence.
- Validate memory-derived claims against live workspace files before relying on them.
- Prefer 1–5 high-signal candidates over many weak ones.
- Every candidate must be ready to write directly as a pending learning file.
- Use exact evidence paths.
- Do **not** use IDs, categories, confidence scores, classifications, or occurrence counts.
- Do **not** propose archives or indexes as learning outputs.
- Do not invent a learning when the evidence is too thin.

## Body template
Every created or normalized learning should use this structure:

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

## Mode 1 — Creation
Use this when the user input is **not** exactly `review`.

### Workflow
1. Gather the best available evidence for the requested focus:
   - `.ai/current-work.md`
   - root-level `.ai/<slug>-review.md` artifacts
   - recent `.ai/*.md` spec/plan/review docs
   - recently changed files (`git diff --name-only`, `git status --short`)
   - user-mentioned files
   - an explicitly provided session transcript path
2. Keep your own work light, but mine the candidates yourself from the gathered evidence.
   - Optional nested delegation is allowed only for narrow session-transcript mining or broad changed-file summarization.
   - Do **not** spawn another learn-specific analyst agent just to restate the same candidate-mining rules.
   - Before writing, ensure each candidate has:
     - a recommended scope (`project` or `global`)
     - a one-sentence summary
     - 1–2 concise sentences on why it is a learning
     - exact evidence paths
     - a full ready-to-write Markdown body using the canonical template
3. Write candidates directly to pending learnings with `learning_write_pending`.
   - Do **not** ask approval before writing pending files.
   - Do **not** create approved learnings directly.
4. If `learning_write_pending` reports a slug collision:
   - If you are running as the top-level current turn, ask via `questionnaire`: Merge, Replace, or Skip, then apply the result with `learning_resolve_collision(mode: "pending_creation", ...)`.
   - If you are running inside `learn-orchestrator`, do **not** decide it silently. Return the unresolved collision details to the caller.
5. Report exact created pending paths.
6. If you are in a direct user-driven skill run, ask whether to continue into review now.
   - If yes, continue with review mode.
   - If no, stop after reporting the created files.

## Mode 2 — Review
Use this when the user input is exactly `review`.

This is the single curation flow. There are no separate cleanup, normalize, or promote commands.

### Phase 1 — Pending review
1. Start with `learning_scan`.
2. Review each pending learning with `questionnaire`.
3. Derive the recommendation in the skill from the scanned facts.
   - project-specific file paths or repo details → recommend **Keep as project learning**
   - broadly reusable directive-style guidance with no obvious project coupling → recommend **Keep as global learning**
   - exceptionally stable, high-signal guidance → recommend promotion into `AGENTS.md`
   - default fallback → recommend **Keep as project learning**
4. Present options in this order:
   - Recommended: <best option>
   - Keep as project learning
   - Keep as global learning
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Reject
5. Apply decisions with `learning_apply_review_action`.
   - Always pass the queue item's exact `path`, `scope`, and `status`.
   - Map choices explicitly:
     - Keep as project learning → `action: "approve_pending"`, `fromScope: <item.scope>`, `toScope: "project"`
     - Keep as global learning → `action: "approve_pending"`, `fromScope: <item.scope>`, `toScope: "global"`
     - Promote into project AGENTS.md → use the promotion flow below (`learning_promotion_preview` → user confirm → `learning_apply_review_action(action: "promote", ..., confirmationToken)`), with `scope: <item.scope>`, `status: "pending"`, `target: "project"`
     - Promote into global AGENTS.md → use the promotion flow below (`learning_promotion_preview` → user confirm → `learning_apply_review_action(action: "promote", ..., confirmationToken)`), with `scope: <item.scope>`, `status: "pending"`, `target: "global"`
     - Reject → `action: "reject_pending"`
6. If a decision returns `status: "collision"`, read both files and resolve it with `questionnaire` plus `learning_resolve_collision(mode: "review", ...)`, again carrying forward the exact source/collision scopes and statuses.
   - When a merge/replace resolution should consume the source learning during approve-pending review, set `deleteSourceOnResolved: true`.

### Phase 2 — Existing-learning review
1. Ask whether to review existing approved learnings.
2. Use the approved items from `learning_scan`.
3. Review each one with `questionnaire`.
4. Derive the recommendation in the skill from the scanned facts.
   - reviewed within 30 days → recommend **Keep**
   - old, stable, directive-style guidance → recommend promotion into `AGENTS.md`
   - project learning that is broadly reusable → recommend **Promote to global learning**
   - low-value or redundant learning → recommend **Remove**
   - malformed or weak items with potentially salvageable content → prefer normalization/keep over blind deletion
   - default fallback → recommend **Keep**
5. Present options in this order:
   - Recommended: <best option>
   - Keep
   - Promote to global learning (project learnings only)
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Remove
   - Consolidate with another
6. Apply decisions with `learning_apply_review_action`.
   - Always pass the queue item's exact `path`, `scope`, and `status: approved`.
   - Map choices explicitly:
     - Keep → `action: "keep"`, `scope: <item.scope>`
     - Promote to global learning → `action: "move_to_scope"`, `fromScope: <item.scope>`, `toScope: "global"`
     - Promote into project AGENTS.md → use the promotion flow below (`learning_promotion_preview` → user confirm → `learning_apply_review_action(action: "promote", ..., confirmationToken)`), with `scope: <item.scope>`, `status: "approved"`, `target: "project"`
     - Promote into global AGENTS.md → use the promotion flow below (`learning_promotion_preview` → user confirm → `learning_apply_review_action(action: "promote", ..., confirmationToken)`), with `scope: <item.scope>`, `status: "approved"`, `target: "global"`
     - Remove → `action: "remove"`
     - Consolidate with another → `action: "consolidate"` with explicit primary/secondary paths and scopes
7. Resolve collisions with `learning_resolve_collision(mode: "review", ...)` when needed, carrying forward the exact source/collision scopes and statuses.
   - When a merge/replace resolution should consume the source learning during move-to-scope or other source-consuming review actions, set `deleteSourceOnResolved: true`.

### Phase 3 — Normalization check
1. Re-run `learning_scan`.
2. Review normalization fixes with `questionnaire`.
3. Apply approved fixes with `learning_apply_review_action(action: "normalize")`, always passing the item's exact `path`, `scope`, and `status`.
4. If normalization hits a filename collision, resolve it with `learning_resolve_collision(mode: "review", ...)`.
   - When a merge/replace normalization resolution should consume the normalized source file, set `deleteSourceOnResolved: true`.

## Promotion flow
Promotion is only available during review mode.

1. Read the target `AGENTS.md` and choose the best-fitting section semantically.
2. Use `learning_promotion_preview` before every promotion confirmation.
3. Show the preview in `questionnaire`:
   - Confirm
   - Edit placement
   - Cancel
4. Only call `learning_apply_review_action(action: "promote")` after the user explicitly confirmed the latest preview.
5. Pass the matching `confirmationToken` from the latest preview.

## Output expectations
Keep outputs concise but explicit:
- created, moved, merged, promoted, normalized, or deleted files with exact paths
- review decisions taken
- whether explicit current-work learning candidates were the primary source
- any collisions handled
- any assumptions made
