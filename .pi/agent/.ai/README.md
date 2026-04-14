# Pi Agent Memory System

This folder is the central, human-readable index for how memory and learning work together in this repo.

## Reading order

1. `.ai/README.md` — this overview
2. `.ai/current-work.md` — active or last completed tracked feature context
3. `.ai/project-profile.md` — compact project summary used in base context
4. `.ai/user-profile.md` — compact global user summary used in base context
5. `.ai/learning.md` and `.ai/global-learning.md` — approved reusable learning records
6. `.ai/pending-learnings.md` and `.ai/pending-memory-proposals.md` — approval queues
7. `.ai/references/` — pull-based supporting notes, not canonical memory
8. `.ai/self-learning-loop-agent-harness-spec.md` / `.ai/self-learning-loop-agent-harness-plan.md` — full design and implementation details

## The layers

### 1. Session memory
- Backed by Pi session history and compaction.
- Used for short-term conversational continuity.
- Not the canonical place for durable repo rules.

### 2. Working memory
- Primary file: `.ai/current-work.md`
- Holds the current feature objective, decisions, status, blockers, and restart step.
- This is the first place to update during active implementation work.

### 3. Profile memory
- Global: `.ai/user-profile.md`
- Project: `.ai/project-profile.md`
- These are compact prompt-ready summaries.
- They are summaries of durable facts, not the canonical source of truth.
- They should not merely restate instructions already guaranteed by `AGENTS.md`, loaded skills, or the system/developer prompt.
- Use profiles for distilled stable preferences, high-signal repo context, and compact current focus only when that information is not already guaranteed elsewhere.

### 4. Learning memory
- Global approved learning store: `.ai/global-learning.md`
- Project approved learning store: `.ai/learning.md`
- Pending queue: `.ai/pending-learnings.md`
- Learning records capture reusable patterns, mistakes, tactics, and preferences.
- They are approval-gated and should stay concise, evidence-backed, and scoped.

### 5. Durable project memory
- Canonical durable files live in `.ai/project.md`, `.ai/conventions.md`, `.ai/pitfalls.md`, and `.ai/decisions/` when present.
- Promotions move validated patterns from learnings into these files.

### 6. Reference memory
- Manifest: `.ai/references/index.md`
- Notes: `.ai/references/*.md`
- References are retrievable source material.
- They help with task-time augmentation, but they do not replace canonical memory or approval-gated durable writes.

## How it works together

### Session start
The memory-system extension builds a base package from:
- `.ai/user-profile.md`
- `.ai/project-profile.md`
- `.ai/current-work.md`
- pending review queues when relevant

This gives the agent compact, always-useful context before task-specific retrieval happens.

### Task start
The extension then builds task augmentation from the most relevant mix of:
- current work
- approved learning records
- durable project memory
- references
- rehydrated compaction hints

Project-local guidance should win over equivalent global guidance.
General-global prompts should avoid dragging in completed feature anchors or project-specific memory unless the task is actually repo-specific.

### Subagent cost control
- Agent-spawned child `pi` processes should run with `PI_SUBAGENT=1`.
- Under `PI_SUBAGENT=1`, GitHub Copilot requests are treated as agent-initiated via `X-Initiator: agent`.
- The memory system skips automatic base/task injection in subagent mode so nested `pi` calls do not multiply prompt cost unnecessarily.
- Explicit inspection commands such as `/memory-status` still work when invoked intentionally.

### Learning flow
1. Work is reviewed manually, during workflow prompts, or by scheduled analysis.
2. Candidate learnings are proposed.
3. The user approves, queues, or rejects them via `questionnaire`.
4. Approved items are persisted to:
   - `.ai/global-learning.md` for global learnings
   - `.ai/learning.md` for project learnings
5. Deferred items stay in `.ai/pending-learnings.md`.

### Promotion flow
- A learning that proves durable can be promoted into project memory or a profile.
- Durable/profile writes remain approval-gated.
- Pending durable/profile proposals live in `.ai/pending-memory-proposals.md`.

### Compaction flow
- Pi compaction remains the short-term continuity mechanism.
- The memory-system extension preserves restartable state and bounded memory hints during compaction.
- Rehydrated compaction data is a hint, not canonical truth.

## File naming convention for learning stores
Use the canonical names everywhere:
- global store: `.ai/global-learning.md`
- project store: `.ai/learning.md`

This repo is both the Pi agent root and the active project root, so these names keep global and project learnings physically separate without extra naming logic.

## Ground rules
- Treat memory-derived statements as hints until validated against the live workspace.
- Keep `.ai/current-work.md` current during meaningful work.
- Use `questionnaire` before durable approval-gated writes.
- Keep evidence paths explicit.
- Prefer updating summaries over append-only sprawl.

## Helpful commands
- `/memory-status` — show which memory artifacts are active and how budgets were used
- `/learn ...` — analyze recent work for learnings and promotions
- `bun scripts/eval-memory-system.ts phase1`
- `bun scripts/eval-memory-system.ts phase2`
- `bun scripts/eval-memory-system.ts phase3`
- `bun scripts/eval-memory-system.ts phase4`
- `bash scripts/scheduled-learn.sh --dry-run --project <path> --agent-root <path>`
