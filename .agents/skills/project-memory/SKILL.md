---
name: project-memory
description: Manage project memory and tracked feature work across sessions. Use when the user asks to remember things, persist conventions, resume a feature, start tracked work, save a handoff, or when the agent needs conventions for `.ai/` artifacts, promotion into durable memory or ADRs. Also use at the start of non-trivial repo work to check existing memory and any active feature anchor.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Give a repository a durable memory layer and a feature-level context anchor that help agent sessions start faster, lose less reasoning, and repeat fewer mistakes.

## Two layers of memory

- **Project memory** = stable repo-wide context. Conventions, durable constraints, recurring pitfalls, canonical commands, long-lived decisions, user preferences.
- **Feature anchor** = `.ai/current-work.md` for one active feature. Current constraints, decisions and rationale, rejected alternatives, open questions, implementation state, restart instructions.

During active feature work, **read project memory but write new findings into `current-work.md`**. At feature completion, promote durable discoveries into project memory or ADRs.

## Default layout

Prefer a repo-root `.ai/` folder:

```text
.ai/
  README.md          # index and reading order
  project.md         # goals, boundaries, domain facts, user preferences
  conventions.md     # coding, testing, workflow rules
  pitfalls.md        # recurring gotchas with root causes and fixes
  decisions/         # YYYY-MM-DD-short-title.md — durable decisions with rationale
  current-work.md    # active feature anchor
  <slug>-spec.md     # optional active feature spec
  <slug>-plan.md     # optional active feature plan
  <slug>-review.md   # optional active feature review
  archive/           # archived feature snapshots
  scratchpad.md      # optional, temporary — not authoritative
```

Version memory in git by default. If notes are personal, use `.gitignore` or follow the repo's existing policy.

### Respect existing conventions

Do not introduce `.ai/` if the repo already has memory. Check for:
1. `.ai/` → `memory/` → `AGENT_MEMORY.md` → `PROJECT_MEMORY.md`
2. If nothing exists, create `.ai/`.

Extend the existing pattern instead of creating a competing system.

---

## Start-of-session workflow

### 1) Find the project root

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

For monorepos, prefer the git root unless the package is clearly independent.

### 2) Detect and read memory

Look for memory in order: `.ai/README.md` → `.ai/current-work.md` → relevant files under `.ai/` → `memory/` → `AGENT_MEMORY.md` → `PROJECT_MEMORY.md`.

Read selectively:
- Start with the index if it exists.
- If `.ai/current-work.md` exists and relates to the task, read it as the active feature anchor.
- Then read only the project-memory files relevant to the current task.
- Re-check critical facts against current code before relying on them.

### 3) Surface what matters

Early in your reply, briefly state:
- which memory files you checked
- whether a feature anchor is active
- 2-5 most relevant takeaways
- any stale or conflicting information you noticed

### Trivial tasks

For quick questions or single-step tasks (e.g. "what's the test command?", "rename this variable"), reading project memory is enough. Skip tracked-work sections if there is no active feature and the task won't span sessions.

---

## Project memory

### What belongs in project memory

Durable, cross-feature facts not obvious from code alone:
- Non-obvious architecture boundaries and integration rules
- Repo-specific conventions (build, test, deploy, naming)
- Setup quirks and environment gotchas likely to recur
- Repeated failure modes with verified fixes
- Canonical commands, paths, and source-of-truth docs
- Long-lived decisions with rationale when the tradeoff matters later
- Recurring user preferences that affect future work

### What does not belong anywhere

- Secrets, tokens, credentials, personal data
- Raw transcripts, large logs, stack traces
- Speculative guesses presented as facts
- Facts already obvious from the codebase

### Write policy for project memory

#### During active feature work

Treat project memory as **read-mostly**:
- Do not create new project-memory entries for in-progress feature findings.
- Only update project memory mid-feature if the user explicitly asks or a stable repo-wide fact must be corrected immediately.

#### Outside tracked feature work

Update project memory directly when you verify durable facts.

### Size limits

Keep individual memory files **under 150 lines**. If a file grows past that, split or prune before adding more.

### Writing style

- Short bullets with strong headings
- File paths and commands instead of prose descriptions
- Dates for meaningful updates
- Rationale for decisions — enough context that a future session understands why
- Prefer distilled facts over logs or narration

**Example pitfall entry:**

```md
## 2026-03-25 — Vite build fails with env mismatch
- Symptom: `pnpm build` fails when `APP_ENV` is unset.
- Cause: `src/config.ts` assumes `APP_ENV` always exists.
- Fix: run builds with `.env.production` loaded or set `APP_ENV=production`.
- Evidence: `src/config.ts`, `package.json`
```

**Example decision entry:**

```md
# 2026-03-25 — Keep API schemas in `packages/contracts`
- Decision: Store shared API schemas in `packages/contracts`, generate clients from there.
- Why: Frontend and backend kept drifting when schemas lived beside the server.
- Implication: Future endpoint changes must update contracts package first.
```

### Handling stale memory

Memory is not the source of truth. If memory conflicts with code, tests, or current docs:
1. Trust code/tests/docs first.
2. Verify the conflict.
3. Update or remove stale memory.
4. Mention the correction in your reply.

---

## Tracked feature work

### When to track

Track a feature when:
- it spans multiple sessions
- the risk of lost context is real and re-establishing it is expensive
- a workflow prompt or the user explicitly starts tracked work
- the agent judges the task is big enough to warrant a feature anchor

For a quick question or single-session fix, skip tracking. A few decision bullets in project memory may be enough.

### Creating `current-work.md`

Create `.ai/current-work.md` when starting a new tracked feature. If one already exists for a different feature, ask the user before replacing it.

Keep only one tracked feature in top-level `.ai/`:
- `.ai/current-work.md`
- optional `.ai/<slug>-spec.md`
- optional `.ai/<slug>-plan.md`
- optional `.ai/<slug>-review.md`

All top-level tracked-work files must use the same slug.

When starting a new tracked feature, mark the previous `current-work.md` as done and archive the previous feature's `spec/plan/review` files into `.ai/archive/` before creating new ones.

### Lifecycle

- Read project memory at feature start for stable context.
- Record all new implementation findings in `current-work.md`, not in project memory.
- Update `current-work.md` at meaningful pause points: after major decisions, resolved questions, discovered constraints, and before ending a session.
- When the feature completes, run a promotion review.
- After promotion, archive feature artifacts and leave `current-work.md` ready for the next feature.

### `current-work.md` template

Keep it compact — a working record, not a transcript. Aim for 50–100 lines with distilled reasoning instead of chronology.

This is the minimal structure. Add sections (e.g. assumptions, parking lot, linked artifacts, relevant files) when the feature needs them — don't pad with empty sections.

```md
# [Feature title]

- **Slug**: <slug>
- **Status**: In progress | Done
- **Started**: YYYY-MM-DD
- **Updated**: YYYY-MM-DD

## Objective

[What this feature achieves — 1-3 sentences.]

## Decisions & rationale

- [Decision] — [why, what it enables or prevents]
- [Rejected alternative] — [why rejected]
- ...

## Current state

[What is done, what is in progress, what is next.]

## Next restart step

[Exactly where to pick up in a new session.]

## Open questions / blockers

- [Question or blocker] — [why it matters]
- ...

## Promotion candidates

- [Finding that may belong in project memory or an ADR]
- ...
```

### Slug convention

Derive from the feature title: lowercase, hyphenated, concise (e.g. `auth-refresh-token`, `fix-build-race`).

### Feature artifacts

Named by slug alongside `current-work.md` while the feature is active:
- `.ai/<slug>-spec.md`
- `.ai/<slug>-plan.md`
- `.ai/<slug>-review.md`

Only create what the workflow actually needs — not all three every time.

---

## Promotion review

When a feature is done, review `current-work.md` and classify what should happen next.

### Promote to project memory

Facts that should influence future work across the repo:
- Conventions and workflow rules
- Canonical commands or paths
- Durable repo constraints
- Recurring pitfalls with verified fixes
- Long-lived user preferences

### Promote to ADR or decision doc

Decisions that should outlive the feature and be visible broadly:
- Cross-feature architectural choices
- Significant tradeoffs that will matter later
- Rejected alternatives worth remembering to avoid re-litigating them
- Decisions that affect multiple teams, systems, or future designs

### Keep only in the archived feature record

Details that matter for history but not for ongoing repo memory:
- Temporary implementation state
- One-off debugging notes
- Expired blockers
- Branch-local execution details

Always tell the user what was promoted, what was archived only, and where each artifact lives.

---

## Archive

Move completed or replaced tracked-work artifacts to `.ai/archive/` with dated prefixes. Include the final `current-work.md` snapshot so the feature anchor survives closure.

Examples:
- `.ai/archive/YYYY-MM-DD-<slug>-current-work.md`
- `.ai/archive/YYYY-MM-DD-<slug>-spec.md`
- `.ai/archive/YYYY-MM-DD-<slug>-plan.md`
- `.ai/archive/YYYY-MM-DD-<slug>-review.md`

---

## Session-end check

Before finishing meaningful work, ask:
- Did I learn a repo-specific rule that future sessions would rediscover?
- Did I hit a trap that's likely to recur?
- Did the user express a durable preference?
- Did I make or confirm a decision whose rationale matters later?
- If I closed this session now, could the next session restart without anxiety?

If a feature is active, update `.ai/current-work.md` first. If the feature is complete, run the promotion review.

---

## Response patterns

When you read memory:

```md
Memory checked: `.ai/README.md`, `.ai/current-work.md`, `.ai/conventions.md`
Feature anchor active: auth-refresh-token (in progress)
Relevant: Retries must stay in BullMQ. Use `pnpm`, not `npm`. Integration tests under `apps/api/test`.
```

When you write project memory:

```md
Memory updated:
- `.ai/pitfalls.md` — added Prisma migration lock fix
- `.ai/project.md` — noted CSV exports use semicolon delimiters
```

When you update the feature anchor:

```md
Feature anchor updated:
- `.ai/current-work.md` — captured retry decision, rejected wrapper abstraction, next restart step
```

When you run a promotion review:

```md
Promotion review complete:
- `.ai/conventions.md` — promoted: always use `pnpm`, never `npm`
- `.ai/decisions/2026-03-31-bullmq-direct.md` — promoted: use BullMQ directly, no wrapper
- `.ai/archive/2026-03-31-auth-refresh-token-current-work.md` — archived feature snapshot
```
