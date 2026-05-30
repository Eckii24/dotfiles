---
name: learn
description: Extract reusable learnings from work/review/session evidence, create pending files, or run questionnaire-based learning review.
---

# Learn

Canonical learning workflow. Two modes:

- **Creation**: user input is anything except exactly `review`. `learn-orchestrator` defaults here.
- **Review**: user input is exactly `review`.

## Model

- Project learnings: approved `<project-root>/.ai/learnings/*.md`, pending `<project-root>/.ai/learnings/pending/*.md`.
- Global learnings: approved `~/.agents/learnings/*.md`, pending `~/.agents/learnings/pending/*.md`.
- Approved learnings inject only filename + summary; body is on-demand.
- Refs are hints; validate live workspace facts before relying on them.

## Evidence rules

Prefer high-signal evidence:
1. `.ai/current-work.md`, especially `Learning candidates`, pitfalls, rejected options, review fixes.
2. `.ai/<slug>-review.md` cumulative ledgers; resolved findings still count as evidence.
3. Changed files, spec/plan/review docs, explicit session transcript paths.

Keep candidate count low: 1-5 good learnings > many weak ones. Every candidate needs scope, one-sentence summary, why it matters, exact evidence paths, and ready Markdown body. No IDs/categories/confidence/occurrence counts. No archive/index proposals. Do not invent thin learnings.

## Body template

```md
## Why
[Why this matters.]

## When to Apply
[Concrete triggers.]

## When Not to Apply
[Where not applicable.]

## Details
[Evidence paths, examples, rationale.]
```

## Creation mode

1. Gather focused evidence from available current-work, review artifacts, recent `.ai/*.md`, `git diff --name-only`, `git status --short`, user-mentioned files, and explicit session path.
2. Mine candidates yourself. Optional nested delegation only for narrow transcript mining or broad changed-file summaries. Do not spawn another learn-specific analyst.
3. Write pending learnings directly with `learning_write_pending`. Do not ask before pending creation. Never create approved learnings directly.
4. Collision handling:
   - Top-level skill run: ask `questionnaire` (Merge / Replace / Skip), then call `learning_resolve_collision(mode: "pending_creation", ...)`.
   - Inside `learn-orchestrator`: return unresolved collision details to caller; do not decide.
5. Report exact pending paths.
6. Direct user skill run only: ask whether to continue into review now.

## Review mode

Use tools; no manual file edits.

### Phase 1: pending learnings

1. Start with `learning_scan`.
2. For each pending item, decide recommendation from facts:
   - project paths/repo details -> keep project
   - broadly reusable, no project coupling -> keep global
   - stable high-signal directive -> promote to AGENTS.md
   - default -> keep project
3. Ask with `questionnaire`, options in this order:
   - Recommended: <best option>
   - Keep as project learning
   - Keep as global learning
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Reject
4. Apply exact mapping:
   - project -> `learning_apply_review_action(action: "approve_pending", fromScope: item.scope, toScope: "project", path: item.path)`
   - global -> `approve_pending`, `toScope: "global"`
   - promote -> promotion flow below, `scope: item.scope`, `status: "pending"`, `target: "project"|"global"`
   - reject -> `reject_pending`
5. On `status: "collision"`: read both files, ask `questionnaire`, resolve with `learning_resolve_collision(mode: "review", ...)`; use `deleteSourceOnResolved: true` when approve-pending merge/replace consumes source.

### Phase 2: approved learnings

1. Ask whether to review approved learnings.
2. Use approved items from prior `learning_scan`.
3. Recommend:
   - reviewed within 30 days -> Keep
   - old stable directive -> promote into AGENTS.md
   - project learning broadly reusable -> Promote to global
   - low-value/redundant -> Remove
   - malformed but salvageable -> Normalize/Keep rather than delete
   - default -> Keep
4. Ask with `questionnaire`, options:
   - Recommended: <best option>
   - Keep
   - Promote to global learning (project learnings only)
   - Promote into project AGENTS.md
   - Promote into global AGENTS.md
   - Remove
   - Consolidate with another
5. Apply mapping:
   - keep -> `learning_apply_review_action(action: "keep", scope: item.scope, path: item.path, status: "approved")`
   - move global -> `move_to_scope`, `fromScope: item.scope`, `toScope: "global"`
   - promote -> promotion flow below, `scope: item.scope`, `status: "approved"`, target project/global
   - remove -> `remove`
   - consolidate -> `consolidate` with explicit primary/secondary paths and scopes
6. Resolve review collisions with `learning_resolve_collision(mode: "review", ...)`; set `deleteSourceOnResolved: true` when the source should be consumed.

### Phase 3: normalization

1. Re-run `learning_scan`.
2. Review normalization proposals with `questionnaire`.
3. Apply approved fixes with `learning_apply_review_action(action: "normalize", path, scope, status)`.
4. Resolve filename collisions with `learning_resolve_collision(mode: "review", ...)`; use `deleteSourceOnResolved: true` when normalized source should be consumed.

## Promotion flow

Only during review mode:

1. Read target `AGENTS.md`; choose best semantic section.
2. Call `learning_promotion_preview` before every confirmation.
3. Show preview in `questionnaire`: Confirm / Edit placement / Cancel.
4. Only after explicit confirm, call `learning_apply_review_action(action: "promote", ..., confirmationToken)`.
5. Use confirmationToken from latest preview only.

## Output

Concise, exact paths only:
- created/moved/merged/promoted/normalized/deleted files
- decisions taken
- whether current-work learning candidates were primary evidence
- collisions handled
- assumptions made
