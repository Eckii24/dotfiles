# No-prompt workflow review

Date: 2026-03-26
Related bead: `agent-px1.4`

## Scope
Review how the current global Pi setup behaves when the user starts work with a plain natural-language request instead of an explicit slash prompt such as `/idea-to-code`, `/story-to-code`, or `/implement`.

Reviewed files:
- `AGENTS.md`
- `agents/*.md`
- `prompts/*.md`
- `settings.json`
- `extensions/copilot-bridge.ts`
- `extensions/ralph-loop.ts`
- `.beads/PRIME.md`
- Pi docs: `README.md`, `docs/prompt-templates.md`, `docs/extensions.md`

## What currently happens without a prompt

### Always active
- `AGENTS.md` is loaded automatically for every session/turn as part of Pi context-file loading.
- Installed extensions are active, including `questionnaire` and `subagent` packages from `settings.json`.
- Global prompt templates are discoverable and shown in the UI, but they do not execute unless invoked explicitly via `/name`.
- Thin sub-agent definitions in `agents/*.md` exist and can be used by the `subagent` tool, but only if the orchestrator decides to call them.

### Not automatic
- `prompts/*.md` do not run unless the user types `/idea-to-code`, `/story-to-code`, `/implement`, etc.
- No extension currently routes arbitrary freeform user requests into one of those workflows.
- No extension currently guarantees bead creation/claiming, progress-file creation, or multi-phase orchestration for plain requests.

## Net effect
Without a slash prompt, the setup still provides:
- global behavioral policy from `AGENTS.md`
- access to `questionnaire`
- access to `subagent`
- available thin agents if the main agent chooses to delegate
- available skills if the model chooses to load them

Without a slash prompt, the setup does **not** provide guaranteed execution of the designed workflows:
- no guaranteed top-level bead resolution/creation
- no guaranteed child-bead decomposition
- no guaranteed `.ai/` progress artifact creation
- no guaranteed spec/plan/review gate sequence
- no guaranteed one-child-bead-per-subagent cadence

In short: without a prompt, you keep the **rules** but lose most of the **choreography**.

## Structural issue
The strongest behavior is currently encoded in global resources:
- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/prompts/*.md`
- `~/.pi/agent/agents/*.md`

That means the Beads-first workflow policy is effectively global. If the intent is to apply this only in selected repos, the current scoping is too broad.

## Practical interpretation
- Plain “start work” requests still benefit from the setup because the model sees the workflow expectations in `AGENTS.md` and can manually use `questionnaire`, `subagent`, `bd prime --stealth`, and `.ai/` artifacts.
- But this relies on model initiative and prompt quality, not on a deterministic entry workflow.
- The explicit slash prompts are where the real workflow enforcement lives today.

## Improvement options

### Option A — keep freeform starts, add a lightweight workflow router
Add an extension that intercepts substantial freeform requests and either:
- routes them into the right workflow automatically, or
- asks a short `questionnaire`: `idea-to-code`, `story-to-code`, `implement`, `review`, or `freeform`

Best for: preserving natural chat UX while recovering deterministic workflow entry.

### Option B — add a generic default entry prompt
Create something like `/work` or `/start-work` that:
- runs `bd prime --stealth`
- decides whether the request is plan-only / implementation / review / story-driven
- creates or resumes the right bead structure
- then dispatches to the existing prompts/subagents

Best for: minimal code change, lower risk, clearer operator habit.

### Option C — tighten `AGENTS.md` fallback behavior
Add a concise fallback algorithm for non-prompt starts, e.g.:
1. If request is substantial, run `bd prime --stealth`
2. Determine whether the task is review / implementation / planning / story-driven
3. Create or resume a top-level bead
4. Create/select exactly one child bead
5. Use `questionnaire` for ambiguity
6. Delegate one child task only

Best for: no new extension required, but still less deterministic than routing.

### Option D — fix scope leakage
If Beads is not intended as a universal default for every repo, move repo-specific workflow policy out of the global `AGENTS.md` and into project-local `AGENTS.md` files, or gate the global instructions on repo signals such as `.beads/`, `.ai/`, or an explicit user request.

## Recommended next step
The highest-value next step is **Option A or B**:
- If you want natural chat to “just work,” build a small workflow-router extension.
- If you want simpler, lower-risk behavior, add `/work` as the canonical default entrypoint.

## Status for rollout bead
This review clarifies a phase-4 gap: the updated workflows are strong when explicitly invoked, but plain natural-language starts still depend on soft policy rather than enforced orchestration.