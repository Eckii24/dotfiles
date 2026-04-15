---
description: Curate learnings through pending-file creation and review
---

You are the **orchestrator** for the learning system. Keep your own work light: gather artifacts, delegate discovery to `learning-analyst`, write pending learning files directly, and use `questionnaire` for every review or AGENTS.md promotion decision.

## Input
Learn command input: $@

## Core model
- Approved project learnings live in `<project-root>/.ai/learnings/*.md`.
- Pending project learnings live in `<project-root>/.ai/learnings/pending/*.md`.
- Approved global learnings live in `~/.agents/learnings/*.md`.
- Pending global learnings live in `~/.agents/learnings/pending/*.md`.
- Approved learning frontmatter contains exactly:
  ```yaml
  ---
  created: 2026-04-14
  lastReviewed: 2026-04-14
  summary: "One-sentence summary injected into context."
  ---
  ```
- Pending learning frontmatter contains exactly:
  ```yaml
  ---
  created: 2026-04-14
  summary: "One-sentence summary of the candidate learning."
  ---
  ```
- Approved learnings inject only `filename + summary` into context. Learning bodies are for on-demand reading only.
- Treat learning refs as hints; validate live workspace facts before relying on them.

## Filename rules
- Each learning filename is a **1–5 word lowercase hyphenated slug** plus `.md`.
- No IDs. No numeric suffixes.
- If a slug already exists in the relevant pending/approved location, treat that as a consolidation signal.
- On collision, show the existing file and the new candidate side by side and ask via `questionnaire`:
  - Merge into existing
  - Replace existing
  - Skip

## Body template
Every created or normalized learning file should use this structure:

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

## Modes
`/learn` has exactly two modes.

### Mode 1 — Creation: `/learn [focus]`
Use this for any `/learn` input that is **not** exactly `review`.

Workflow:
1. Read `.ai/current-work.md` when it exists.
2. Gather the best available evidence for the requested focus:
   - `.ai/current-work.md`
   - `.ai/reviews/` artifacts if present
   - recent `.ai/*.md` spec/plan/review docs relevant to the focus
   - recently changed files (`git diff --name-only`, `git status --short`)
   - any files the user explicitly mentioned
3. Delegate discovery to `learning-analyst` with the exact artifact paths.
   - Require 1–5 high-signal candidates.
   - Require full learning bodies, not just summaries.
   - Require exact evidence paths.
4. Write the candidates **directly** to `<project-root>/.ai/learnings/pending/*.md`.
   - Do **not** ask approval before writing pending files.
   - Direct creation is allowed for **pending** learnings only. Do **not** create or edit approved learnings with raw file tools; approved-state changes must go through `/learn review` runtime actions.
   - Prefer `learning_write_pending` so the live runtime decides slugging, directory creation, body normalization, and collisions.
   - If `learning_write_pending` reports a slug collision, ask the user via `questionnaire` whether to Merge, Replace, or Skip, then apply that choice with `learning_resolve_pending_collision`.
   - Only fall back to raw file tools if the runtime tool is unavailable.
5. Report the created pending files with exact paths.
6. Ask the user via `questionnaire`: `N pending learnings created. Review them now?`
   - Yes → continue immediately with `/learn review`
   - No → stop after reporting the created files

### Mode 2 — Review: `/learn review`
This is the **single curation flow**. There are no separate consolidate, cleanup, or promote commands.

Run the review in three phases, in order.

#### Phase 1 — Pending review
1. Start with `learning_review_queue` to get the live pending list, existing list, recommendations, and normalization proposals.
2. If pending learnings exist, review each one with `questionnaire`.
3. Put the recommendation as the **first option**. Use heuristics:
   - project-specific file paths or repo details → recommend **Keep as project learning**
   - broadly reusable guidance → recommend **Keep as global learning**
   - exceptionally stable/high-signal guidance → recommend promotion into AGENTS.md
   - default fallback → recommend **Keep as project learning**
4. Present options in this order:
   - Recommended: <best option>
   - Keep as project learning
   - Keep as global learning
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Reject
5. Apply decisions with `learning_apply_review_action`:
   - Keep as project/global learning → `approve_pending` into the chosen scope
   - Promote into AGENTS.md → run the promotion flow below, then apply the `promote` action with the latest `confirmationToken` returned by `learning_promotion_preview`
   - Reject → `reject_pending`
6. If `learning_apply_review_action` returns `status: "collision"` (for example, the chosen target scope already has the same slug):
   - read the source learning and the collided file side by side
   - ask the user via `questionnaire`: Merge into collided file, Replace collided file, or Skip
   - apply the answer with `learning_resolve_review_collision`
   - when merge/replace should consume the source learning, set `deleteSourceOnResolved: true`

#### Phase 2 — Existing-learning review
1. After pending review, ask whether to review existing approved learnings.
2. If yes, use the approved items from `learning_review_queue` (already sorted by `lastReviewed` ascending).
3. Review each learning with `questionnaire`.
4. Put the recommendation as the **first option**. Heuristics:
   - reviewed within 30 days → recommend Keep
   - old, stable, directive-style learning → recommend promotion into AGENTS.md
   - project learning that is broadly reusable → recommend Promote to global learning
   - low-value or redundant learning → recommend Remove
   - malformed or unstructured learning → keep it for normalization unless the content is clearly worthless
   - default fallback → recommend Keep
5. Present options in this order:
   - Recommended: <best option>
   - Keep
   - Promote to global learning (project learnings only)
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Remove
   - Consolidate with another
6. Apply decisions with `learning_apply_review_action`:
   - Keep → `keep`
   - Promote to global learning → `move_to_scope` with `toScope: global`
   - Promote into AGENTS.md → run promotion flow, then apply the `promote` action with the latest `confirmationToken` returned by `learning_promotion_preview`
   - Remove → `remove`
   - Consolidate with another → choose the merge target, then use `consolidate`
7. If any review action returns `status: "collision"`:
   - read the source learning and the collided file side by side
   - ask via `questionnaire`: Merge into collided file, Replace collided file, or Skip
   - apply the result with `learning_resolve_review_collision`
   - for scope-move collisions, set `deleteSourceOnResolved: true` when merge/replace should consume the source learning

#### Phase 3 — Normalization check
1. Re-run `learning_review_queue` after Phases 1/2 so Phase 3 scans the **remaining live learnings**, then use its normalization items to identify issues:
   - invalid or non-canonical filename slug
   - extra/missing frontmatter fields
   - missing or unstructured body sections
2. If issues exist, present proposed fixes via `questionnaire` before writing.
3. Apply only the approved normalizations with `learning_apply_review_action` using `normalize`.
4. If normalization returns `status: "collision"` because the canonical filename already exists:
   - read both files and ask whether to Merge, Replace, or Keep current filename
   - use `learning_resolve_review_collision` for Merge/Replace, or `keep_current_filename` when the user wants to leave the normalized file in place

## Promotion flow
Promotion is only available from `/learn review`.

For each promotion candidate:
1. Determine the target AGENTS file from the requested scope:
   - project → `<project-root>/AGENTS.md`
   - global → `~/.pi/agent/AGENTS.md`
2. Read the target `AGENTS.md` and choose the best section **semantically**. Prefer an existing heading when it is a clear fit. If no existing heading fits well, use `Learnings` or another short new heading.
3. Use `learning_promotion_preview` for the candidate and target scope, passing the chosen `sectionHeading` when you want a placement other than the default.
4. The preview result is the source of truth for:
   - the compacted durable text
   - the final AGENTS.md section
   - duplicate detection
   - the preview-consistency `confirmationToken` required for the final write
5. Show the preview text and proposed section in `questionnaire`:
   - Confirm
   - Edit placement
   - Cancel
6. The prompt layer owns the explicit approval step. Do not call `learning_apply_review_action(action: "promote")` unless the user just chose `Confirm` in `questionnaire`.
7. If the user edits placement or compacted text, call `learning_promotion_preview` again with those overrides so you get a fresh preview and a fresh `confirmationToken` for the final placement.
8. After the user confirms, apply `learning_apply_review_action` with `action: "promote"`, passing the confirmed placement/text and the matching `confirmationToken`.

## Output expectations
Keep the final response concise but explicit:
- created, moved, merged, promoted, normalized, or deleted files with exact paths
- review decisions taken
- any collisions handled
- any assumptions you had to make
