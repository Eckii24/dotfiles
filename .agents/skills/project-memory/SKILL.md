---
name: project-memory
description: Maintain project-scoped memory for coding agents across sessions. Use this skill whenever the user asks to remember things for future sessions, persist learnings, keep handoff notes, store conventions, record recurring gotchas, or create a memory folder or instructions file in a repo. Also use it for multi-step or non-trivial work in an existing repository when durable repo-specific learnings are likely to emerge—especially if the repo already contains `.ai/`, `memory/`, `AGENT_MEMORY.md`, or `PROJECT_MEMORY.md`—so you check existing memory first and update durable facts as you learn them.
compatibility:
  tools: bash, read, write, edit
---

# Project Memory

Use this skill to give a repository a small, durable memory layer that helps future agent sessions start faster and repeat fewer mistakes.

The core idea is simple:
1. At the start of meaningful repo work, check whether project memory already exists and read the relevant parts.
2. During the work, notice durable facts worth keeping.
3. Persist only high-value, non-sensitive memory in a concise, reviewable form.

## Recommended default layout

Prefer a repo-root `.ai/` folder as the default memory location because it is structured, tool-agnostic, and easy to review in git.

Use this layout when starting fresh:

```text
.ai/
  README.md
  project.md
  conventions.md
  pitfalls.md
  decisions/
    YYYY-MM-DD-short-title.md
  scratchpad.md        # optional, short-lived only
```

By default, keep project memory versioned in git so it is reviewable and shared across future sessions. If the repository is shared but the notes are meant to stay personal or local-only, use `.gitignore` or follow the repo's existing policy instead.

### What each file is for

- `README.md`: index and reading order for future sessions
- `project.md`: project goals, boundaries, key context, domain facts, recurring user preferences
- `conventions.md`: coding, testing, workflow, and repo-specific rules
- `pitfalls.md`: recurring gotchas, root causes, fixes, and non-obvious commands
- `decisions/`: durable decisions with rationale; use ISO-style dates like `YYYY-MM-DD` in filenames
- `scratchpad.md`: temporary notes that should later be pruned or promoted elsewhere; clean it up at the end of a meaningful session or once the useful parts have been moved into durable files

## Respect existing repo conventions first

Do not introduce `.ai/` if the repo already has a clear memory convention.

Prefer this order:
1. Existing repo convention already in use
   - `.ai/`
   - `memory/`
   - `AGENT_MEMORY.md`
   - `PROJECT_MEMORY.md`
2. If nothing exists, create `.ai/`

If the repository already uses `memory/` or a single memory file, extend that pattern instead of creating a competing system unless the user asks to migrate.

## Start-of-session workflow

For meaningful work in a repository, do this early.

### 1) Find the project root

Use the git root when available:

```bash
git rev-parse --show-toplevel 2>/dev/null || pwd
```

If the repo is a monorepo, prefer the git root unless the package you are working in is clearly treated as its own independent project with its own conventions and release flow.

If the directory is not a git repo and you may be inside a nested subfolder, avoid guessing too aggressively. Use the nearest obvious project root, and ask the user if the correct memory scope is ambiguous.

### 2) Detect memory

Look for memory in this order:
- `<root>/.ai/README.md`
- `<root>/.ai/`
- `<root>/memory/`
- `<root>/AGENT_MEMORY.md`
- `<root>/PROJECT_MEMORY.md`

### 3) Read selectively, not blindly

If memory exists:
- Start with the index or top-level file
- Read only the files relevant to the current task
- Re-check critical facts against current code, tests, and docs before relying on them

If `.ai/README.md` exists, treat it as the entry point.

### 4) Surface what matters

Early in your reply or working notes, briefly state:
- which memory files you checked
- the 2-5 most relevant takeaways
- any conflicts or stale-looking information you noticed

This helps the user understand that memory was consulted and gives them a chance to correct it.

## When to create memory

Create project memory when one of these is true:
- the user explicitly asks for persistent memory or cross-session context
- the repo has no memory yet, but the task is substantial and durable learnings are emerging
- you discover conventions, pitfalls, or decisions that future sessions are likely to need

Do not create a large memory system for a one-off trivial task.

When bootstrapping from scratch, start small:
- `README.md`
- one or two focused files that actually have content

Do not generate a pile of empty template files unless the user asked for scaffolding.

## What to persist

Persist durable, high-signal facts that are likely to help in later sessions and are not obvious from the code alone.

Good candidates:
- non-obvious project goals or constraints
- recurring user preferences that affect future work
- architecture boundaries or integration rules
- repo-specific coding, testing, or deployment conventions
- setup quirks and environment gotchas
- repeated failure modes and their verified fixes
- canonical commands, paths, or source-of-truth documents
- business rules and glossary items that are easy to forget
- decisions with rationale, especially when the tradeoff matters later

## What not to persist

Do not persist:
- secrets, tokens, credentials, or personal data
- raw chat transcripts
- large logs or stack traces
- speculative guesses presented as facts
- branch-specific status that will expire quickly
- noisy task diary entries
- code copied verbatim when a short pointer would do
- facts that are already obvious from the codebase and unlikely to be forgotten

If information is sensitive, fast-changing, or low-confidence, do not store it as durable memory.

## Default write policy

This skill is biased toward saving important findings by default.

That means:
- if you learn something clearly durable and high-value, write it without waiting for explicit approval
- if something is ambiguous, opinionated, or potentially sensitive, ask before persisting it
- after writing memory, tell the user what you saved and where

A good rule of thumb:
- save verified facts, conventions, and recurring lessons automatically
- ask before saving strategy opinions, provisional judgments, or interpersonal preferences

If you cannot write files in the current environment, still follow the same judgment. Prepare a concise proposed memory update and present the exact file paths and content the user should save.

## Where to write different kinds of memory

Write to the smallest relevant place.

- `README.md`: add or update the index and reading order
- `project.md`: project context, goals, domain rules, user preferences that recur
- `conventions.md`: repo working agreements and standards
- `pitfalls.md`: verified gotchas, failure patterns, and fixes
- `decisions/YYYY-MM-DD-short-title.md`: durable decisions with rationale
- `scratchpad.md`: temporary working notes that may later be pruned or promoted

Avoid turning one file into a dumping ground.

## Writing style for memory entries

Keep memory concise, factual, and easy to skim.

Prefer:
- short bullets
- short sections with strong headings
- links or file paths instead of copied blobs
- dates for meaningful updates
- rationale for decisions

When recording a durable lesson, include enough context that a future session understands why it matters.

### Example pitfall entry

```md
## 2026-03-25 - Vite build fails with env mismatch
- Symptom: `pnpm build` fails when `APP_ENV` is unset.
- Cause: `src/config.ts` assumes `APP_ENV` always exists.
- Fix: run builds with `.env.production` loaded or set `APP_ENV=production`.
- Evidence: `src/config.ts`, `package.json`
```

### Example decision entry

```md
# 2026-03-25 - Keep API schemas in `packages/contracts`

## Decision
Store shared API schemas in `packages/contracts` and generate clients from there.

## Why
The frontend and backend kept drifting when schemas lived beside the server implementation.

## Implication
Future endpoint changes should update the contracts package first.
```

## Handling stale or conflicting memory

Memory is helpful, but it is not the source of truth.

If memory conflicts with code, tests, or current docs:
1. trust code/tests/current docs first
2. verify the conflict
3. update or remove the stale memory
4. mention the correction in your reply

Do not keep contradictory notes around if you can resolve them.

If you are not sure whether something is stale, mark the uncertainty or ask.

## Session-end / milestone updates

When you finish a meaningful chunk of work, quickly ask yourself:
- Did I learn a repo-specific rule that future sessions would otherwise rediscover?
- Did I hit a bug or trap that is likely to recur?
- Did the user express a preference or constraint that should influence future work?
- Did I make or confirm a decision whose rationale matters later?

If yes, update the appropriate memory file before finishing.

## Response pattern

When you use this skill, be explicit with the user.

If you only read memory, include a brief note like:

```md
Memory checked:
- `.ai/README.md`
- `.ai/conventions.md`

Relevant takeaways:
- Use `pnpm`, not `npm`
- Integration tests live under `apps/api/test`
```

If you also wrote memory, include:

```md
Memory updated:
- `.ai/pitfalls.md` — added the verified fix for the Prisma migration lock issue
- `.ai/project.md` — noted that admin users expect CSV exports with semicolon delimiters
```

Keep this short, but do not hide memory changes.

## Practical guardrails

- Prefer updating an existing memory file over creating a new category too early.
- Prefer a short summary plus file path over long prose.
- Prefer verified facts over clever theories.
- Prefer durable guidance over session narration.
- Prefer `.ai/` for new setups, but do not fight an existing repo convention.
- If a memory file grows past roughly 150 lines or becomes hard to skim, split or prune it before adding more.
- Treat `scratchpad.md` as temporary; promote or delete stale notes instead of letting it become permanent clutter.

## Trigger examples

This skill is a strong fit for prompts like:
- “Please remember anything important for future sessions.”
- “Create a memory system for this repo so later agents can pick up faster.”
- “While you debug this, save any recurring gotchas.”
- “Check whether this project already has agent instructions or memory before you start.”
- “Keep track of conventions and decisions as you work.”

It is also appropriate during substantive repo work even when the user does not explicitly say “memory,” if durable repo-specific context is likely to matter.
