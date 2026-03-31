---
name: project-memory
description: Maintain stable project-scoped memory for coding agents across sessions. Use this skill whenever the user asks to remember things for future sessions, persist repo conventions, keep durable handoff notes, or store long-lived decisions and pitfalls. Also use it to read existing project memory at the start of non-trivial repo work. When an active `.ai/current-work.md` feature anchor exists, treat project memory as read-mostly during implementation and defer new findings into `current-work.md` until completion review.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Give a repository a small, durable memory layer that helps future agent sessions start faster and repeat fewer mistakes.

## Two layers of memory

Keep project memory and active feature context separate:

- **Project memory** = stable repo-wide context. Examples: conventions, durable constraints, recurring pitfalls, canonical commands, long-lived decisions, user preferences that matter across features.
- **Feature anchor** = `.ai/current-work.md` for one active feature. Examples: current constraints, decisions and rationale, rejected options, open questions, implementation state, and restart instructions.
- **ADR / decision doc** = promoted record for important architectural choices that should outlive the feature and be referenced broadly.

During active feature work, **read project memory but do not keep adding implementation discoveries there**. Capture them in `.ai/current-work.md` first. At feature completion, review what should be promoted into project memory or an ADR.

The core loop:
1. At session start, check for existing project memory and any active `.ai/current-work.md`.
2. During feature work, record evolving feature context in `current-work.md`.
3. At feature completion, review `current-work.md` and promote only durable, high-value findings into project memory or ADRs.

## Default layout

Prefer a repo-root `.ai/` folder. Use this when starting fresh:

```text
.ai/
  README.md          # index and reading order
  current-work.md    # active feature anchor when work spans sessions
  project.md         # goals, boundaries, domain facts, user preferences
  conventions.md     # coding, testing, workflow rules
  pitfalls.md        # recurring gotchas with root causes and fixes
  decisions/         # YYYY-MM-DD-short-title.md — durable decisions with rationale
  scratchpad.md      # optional, temporary — not authoritative
```

Version memory in git by default. If notes are personal, use `.gitignore` or follow the repo's existing policy.

### Respect existing conventions

Do not introduce `.ai/` if the repo already has memory. Check for:
1. `.ai/` → `memory/` → `AGENT_MEMORY.md` → `PROJECT_MEMORY.md`
2. If nothing exists, create `.ai/`.

Extend the existing pattern instead of creating a competing system.

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
- whether `.ai/current-work.md` is active for this task
- 2-5 most relevant takeaways
- any stale or conflicting information you noticed

## What belongs where

### Put in project memory

Durable, cross-feature facts not obvious from code alone:
- Non-obvious architecture boundaries and integration rules
- Repo-specific conventions (build, test, deploy, naming)
- Setup quirks and environment gotchas likely to recur
- Repeated failure modes with verified fixes
- Canonical commands, paths, and source-of-truth docs
- Long-lived decisions with rationale when the tradeoff matters later
- Recurring user preferences that affect future work

### Put in `.ai/current-work.md`

Active feature context that is still evolving:
- Current constraints and invariants
- Decisions made during implementation and why
- Alternatives considered or rejected
- Open questions, blockers, and assumptions to verify
- Current state of implementation and next restart step
- Findings that might later be promoted into project memory or an ADR

### Do not persist

- Secrets, tokens, credentials, personal data
- Raw transcripts, large logs, stack traces
- Speculative guesses presented as facts
- Branch-specific status that expires quickly
- Facts already obvious from the codebase

## Write policy

### During active feature work

If `.ai/current-work.md` exists for the task, treat project memory as **read-mostly**:
- **Do not** create new project-memory entries for in-progress feature findings.
- **Do** record new decisions, rationale, constraints, open questions, and restart state in `.ai/current-work.md`.
- Only update project memory mid-feature if the user explicitly asks or a stable repo-wide fact must be corrected immediately.

### At feature completion

Run a promotion review before closing out the feature:
- Promote repo-wide conventions, canonical commands, recurring pitfalls, and durable preferences into project memory.
- Promote significant architectural decisions into `.ai/decisions/` or formal ADRs.
- Leave transient implementation details in the archived feature record rather than polluting project memory.
- Always tell the user what was promoted and where.

### Outside tracked feature work

If there is no active `current-work.md`, you may update project memory directly when you verify durable facts.

## Size limits

Keep individual memory files **under 150 lines**. If a file grows past that, split or prune before adding more. Dense, skimmable files are more useful than comprehensive ones that nobody reads.

## Writing style

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

## Handling stale memory

Memory is not the source of truth. If memory conflicts with code, tests, or current docs:
1. Trust code/tests/docs first.
2. Verify the conflict.
3. Update or remove stale memory.
4. Mention the correction in your reply.

## Session-end check

Before finishing meaningful work, ask:
- Did I learn a repo-specific rule that future sessions would rediscover?
- Did I hit a trap that's likely to recur?
- Did the user express a durable preference?
- Did I make or confirm a decision whose rationale matters later?
- If I closed this session now, could the next session restart without anxiety?

If a feature is still active, update `.ai/current-work.md` first. If the feature is complete, review whether anything from `current-work.md` should be promoted into project memory or an ADR.

## Response pattern

When you read memory:

```md
Memory checked: `.ai/README.md`, `.ai/current-work.md`, `.ai/conventions.md`
Relevant: Active feature anchor says retries must stay in BullMQ. Use `pnpm`, not `npm`. Integration tests live under `apps/api/test`.
```

When you write project memory:

```md
Memory updated:
- `.ai/pitfalls.md` — added Prisma migration lock fix
- `.ai/project.md` — noted CSV exports use semicolon delimiters
```

When you defer feature findings into the anchor:

```md
Feature context updated:
- `.ai/current-work.md` — captured retry decision, rejected wrapper abstraction, and next restart step
```
