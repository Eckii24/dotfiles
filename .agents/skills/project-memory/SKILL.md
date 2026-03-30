---
name: project-memory
description: Maintain project-scoped memory for coding agents across sessions. Use this skill whenever the user asks to remember things for future sessions, persist learnings, keep handoff notes, store conventions, record recurring gotchas, or create a memory folder or instructions file in a repo. Also use it for multi-step or non-trivial work in an existing repository when durable repo-specific learnings are likely to emerge—especially if the repo already contains `.ai/`, `memory/`, `AGENT_MEMORY.md`, or `PROJECT_MEMORY.md`—so you check existing memory first and update durable facts as you learn them.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Give a repository a small, durable memory layer that helps future agent sessions start faster and repeat fewer mistakes.

The core loop:
1. At session start, check for existing memory and read the relevant parts.
2. During work, notice durable facts worth keeping.
3. Persist only high-value, non-sensitive memory in concise, reviewable form.

## Default layout

Prefer a repo-root `.ai/` folder. Use this when starting fresh:

```text
.ai/
  README.md          # index and reading order
  project.md         # goals, boundaries, domain facts, user preferences
  conventions.md     # coding, testing, workflow rules
  pitfalls.md        # recurring gotchas with root causes and fixes
  decisions/         # YYYY-MM-DD-short-title.md — durable decisions with rationale
  scratchpad.md      # optional, temporary — promote or delete, don't let it rot
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

Look for memory in order: `.ai/README.md` → `.ai/` → `memory/` → `AGENT_MEMORY.md` → `PROJECT_MEMORY.md`.

Read selectively — start with the index, then only files relevant to the current task. Re-check critical facts against current code before relying on them.

### 3) Surface what matters

Early in your reply, briefly state:
- which memory files you checked
- 2-5 most relevant takeaways
- any stale or conflicting information you noticed

## What to persist

**Good candidates** — durable, high-signal facts not obvious from code alone:
- Non-obvious constraints, architecture boundaries, integration rules
- Repo-specific conventions (build, test, deploy, naming)
- Setup quirks, environment gotchas
- Repeated failure modes with verified fixes
- Canonical commands, paths, source-of-truth documents
- Decisions with rationale when the tradeoff matters later
- Recurring user preferences that affect future work

**Do not persist**:
- Secrets, tokens, credentials, personal data
- Raw transcripts, large logs, stack traces
- Speculative guesses presented as facts
- Branch-specific status that expires quickly
- Facts already obvious from the codebase

## Write policy

Biased toward saving important findings by default:
- **Auto-save**: verified facts, conventions, recurring lessons
- **Ask first**: strategy opinions, provisional judgments, sensitive preferences
- **Always tell the user** what you saved and where

## Size limits

Keep individual memory files **under 150 lines**. If a file grows past that, split or prune before adding more. Dense, skimmable files are more useful than comprehensive ones that nobody reads.

## Writing style

- Short bullets with strong headings
- File paths and commands instead of prose descriptions
- Dates for meaningful updates
- Rationale for decisions — enough context that a future session understands why

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

If yes, update the appropriate memory file.

## Response pattern

When you read memory:

```md
Memory checked: `.ai/README.md`, `.ai/conventions.md`
Relevant: Use `pnpm`, not `npm`. Integration tests live under `apps/api/test`.
```

When you write memory:

```md
Memory updated:
- `.ai/pitfalls.md` — added Prisma migration lock fix
- `.ai/project.md` — noted CSV exports use semicolon delimiters
```
