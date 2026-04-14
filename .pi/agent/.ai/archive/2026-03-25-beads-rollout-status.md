# Beads rollout status

> Superseded by markdown-first current-work workflow documented in `.ai/archive/2026-03-26-process-current-work-workflow-plan.md`.
>
> Active workflow docs now live in `AGENTS.md`, `.ai/current-work.md`, and `.ai/archive/`. Treat the rest of this file as archived history only.

## Historical rollout snapshot
- Date: 2026-03-25
- Scope: implement Beads integration phases 1-3 in `~/.pi/agent`, with no separate Beads session-context extension and with `/ralph` upgraded to fresh-session-per-iteration by default.
- Status: phases 1-3 plus the Ralph fresh-session enhancement are implemented and static/smoke evals pass; phase 4 pilot/validation remains pending.
- Plan: `.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md`

## Retired workflow model
- Beads (`bd`) is now the source of truth for operational work state in this repo: backlog, ready work, dependencies, claim/ownership, and completion.
- Top-level workflows should create or resume an epic/story bead and then create child phase/task beads beneath it.
- Each substantial subagent should claim exactly one child bead/task, complete only that unit of work, report explicit artifact paths, update/close the bead, and exit.
- Prompt templates explicitly invoke `bd prime --stealth`; this rollout does **not** add a separate Beads session-context extension.
- Repo config sets `no-git-ops: true`, so normal `bd` CRUD stays local-only even when a subcommand does not expose `--stealth`.
- `extensions/ralph-loop.ts` now defaults to a fresh Pi session/context per iteration and exposes `--same-session` for legacy behavior when needed.

## Historical artifacts
- `.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md` — historical rollout plan and eval tracking.
- `.ai/archive/2026-03-25-beads-rollout-status.md` — this archived handoff/status file.
- `.ai/` remains the artifact store for specs, implementation plans, review notes, and progress files referenced from beads.

## Bootstrap outcome
- Initial bootstrap was performed without `--stealth` in an earlier rollout slice; the repo is now explicitly enforced as local-only via `bd config set no-git-ops true`.
- Future bootstrap standard: `bd init --stealth -p agent --skip-agents --skip-hooks`
- Validation run: `bd context --json`, `bd doctor --agent`
- Fix applied: untracked `.beads/.beads-credential-key` and added it to `.beads/.gitignore` so local Beads runtime state is not tracked.
- Persisted current Beads DB changes with `bd dolt commit -m "Seed beads rollout tracker"`.
- Working assumption recorded: in `bd` 0.61.0, the smallest workable local bootstrap for this non-git repo still created a local `.git/`; this local-only bootstrap was kept rather than adding more automation.
- Current expected warnings after bootstrap: no hooks installed, local git working tree dirty, and CLI 0.61.0 behind 0.62.0.
- Local-only rule: do not add `.beads/` data to tracked repos and do not use git remotes/sync for Beads in this repo.

## Rollout beads
- Epic: `agent-px1` — Beads integration rollout for `~/.pi/agent`
- Smoke-test beads:
  - `agent-e1j` — created, claimed, and closed successfully during the initial Beads bootstrap validation.
  - `agent-7oi` — created, claimed, and closed after the Ralph enhancement to confirm the Beads lifecycle still works.
- Closed child tasks:
  - `agent-px1.1` — Phase 1 bootstrap Beads and document SSOT boundary
  - `agent-px1.2` — Phase 2 update prompt templates for bead-aware orchestration
  - `agent-px1.3` — Phase 3 update thin agents and keep priming prompt-driven
  - `agent-px1.5` — Phase 3A enhance Ralph loop for fresh-session iteration
  - `agent-px1.6` — Phase 3B fix standalone implementation prompt bead lifecycle semantics
  - `agent-px1.7` — Phase 3C reconcile review-prompt chain semantics and phase-4 eval status
  - `agent-px1.8` — Phase 3D make Beads stealth/local-only by default in docs and config
  - `agent-px1.9` — Phase 3E add ADO-specific bead ID rule for story-to-code
  - `agent-px1.9` — Phase 3E add ADO-specific bead ID rule for story-to-code
- Open child task:
  - `agent-px1.4` — Phase 4 pilot updated workflows and complete rollout validation

## Phase status
- Phase 1: complete
  - Added `.beads/PRIME.md`
  - Updated `AGENTS.md`
  - Bootstrapped local Beads and linked rollout beads to the plan/status artifacts
- Phase 2: complete
  - Updated `prompts/idea-to-code.md`
  - Updated `prompts/story-to-code.md`
  - Updated `prompts/scout-and-plan.md`
  - Updated `prompts/implement.md`
  - Updated `prompts/implement-and-review.md`
- Phase 3: complete
  - Updated thin agents in `agents/*.md` to echo bead context and explicit artifact paths
  - Added explicit eval/test-results output guidance to `agents/worker.md`
  - Left `settings.json` unchanged
  - Confirmed no `extensions/beads-session-context.ts` was added
  - Enhanced `extensions/ralph-loop.ts` to default to fresh-session-per-iteration via Pi session APIs
  - Fixed standalone implementation prompt bead-lifecycle semantics in `prompts/implement.md` and `prompts/implement-and-review.md`
  - Switched repo guidance to local-only stealth mode: `bd prime --stealth` in prompts/docs plus `no-git-ops: true` in Beads config
  - Added an ADO-specific ID rule: `/story-to-code` uses `ado-<id>` for numeric Azure DevOps stories and child beads inherit that hierarchy; all other workflows keep the normal `agent` prefix
  - Added an ADO-specific ID rule: `/story-to-code` uses `ado-<id>` for numeric Azure DevOps stories and child beads inherit that hierarchy; all other workflows keep the normal `agent` prefix

## Pilot workflow
- Pilot status: pending
- Not started in this rollout slice.
- Phase 4 is **partially complete**: smoke/handoff checks passed, but the real pilot workflow is still pending.
- Recommended pilot for phase 4: run one real `/idea-to-code` or `/story-to-code` flow using the updated prompt instructions, create/use a top-level bead with child task beads, and verify the one-child-bead-per-subagent cadence end to end.

## Remaining gaps / follow-ups
- Phase 4 validation is still open in Beads as `agent-px1.4`.
- The fresh-session Ralph loop still needs end-to-end pilot validation alongside the updated Beads-aware prompts.
- Because `bd init` created a local `.git/`, future agents should remember this workspace is still operationally local-only even though a git directory now exists.

## Next actions
1. Run the phase 4 pilot workflow from `agent-px1.4` using the updated prompt templates and `bd prime --stealth`.
2. Capture pilot results, linked artifacts, and any prompt gaps in this file and in the plan.
3. Run the phase 4 Beads smoke/eval steps once the pilot is complete.
4. Close `agent-px1.4` and then close `agent-px1` when rollout validation is done.
