# Learning System Skill Integration

- **Slug**: learn-skill-integration
- **Status**: In progress
- **Started**: 2026-04-16
- **Updated**: 2026-04-16

## Objective

Replace the remaining prompt-owned learn entrypoint with a real `learn` skill, wire all tracked-work workflow prompts to trigger learning extraction through `learn-orchestrator`, and extend `current-work.md` with a minimal Todo Tracker that stays high-level while detailed execution steps live in plan artifacts.

## Todo Tracker

- [x] Learn skill entrypoint switched to the discoverable global skill
- [x] Tracked-work prompts rewired to trigger `learn-orchestrator`
- [x] `current-work.md` contract updated with a minimal Todo Tracker
- [x] Learning runtime hooks and live guidance updated for `/skill:learn review`
- [x] Verification completed
- [x] Learning-tool-surface audit completed
- [ ] User confirmed feature complete
- [ ] Active artifacts archived

## Decisions & rationale

- Use a real `learn` skill as the canonical learning workflow so it can be triggered manually via `/skill:learn review` and read explicitly by `learn-orchestrator`.
- Keep `learn-orchestrator` as the automatic creation/extraction worker triggered by orchestration prompts.
- Keep `current-work.md` Todo Trackers intentionally minimal: only major phases belong there; detailed work breakdown stays in `.ai/<slug>-plan.md` when present.
- Preserve review artifacts as cumulative ledgers so resolved findings remain available to learning extraction.
- Archive tracked-work artifacts only after the user explicitly confirms the work is complete.

## Current state

- The discoverable global skill now lives at `skills/learn/SKILL.md`, and the older prompt/root-skill drafts have been removed from live discovery locations.
- Live workflow prompts now include the minimal Todo Tracker guidance, a guaranteed `learn-orchestrator` handoff, and post-learning archive confirmation.
- Targeted grep/readback verification, review passes, and a learning-tool-surface audit are complete.
- The audit result is to keep a runtime-backed learning layer; simplifying to an inject-only extension would regress path safety, slug/collision integrity, and promotion-token handling.
- The concrete simplification pass now reduces the public tool surface by moving review heuristics into the `learn` skill, replacing `learning_review_queue` with fact-only `learning_scan`, hardening `learning_apply_review_action`, and unifying collision handling behind `learning_resolve_collision`.
- `learning-analyst` has been removed from the live workflow surface; candidate-mining rules now live in `skills/learn/SKILL.md`, while `agents/learn-orchestrator.md` stays intentionally lean.
- The remaining optional follow-up is a live smoke verification for `/skill:learn review` and the `learn-orchestrator` handoff.

## Next restart step

If the user wants a live smoke pass, reload Pi resources and run `/skill:learn review` once plus one orchestrator prompt path that ends in `learn-orchestrator`. Otherwise the next workflow step is user completion confirmation and archive decision.

## Open questions / blockers

- None for the current implementation pass.

## Pitfalls & surprises

- Skill discovery rules depend on scope. In this repo, `skills/learn/SKILL.md` is valid because the repo root is also `~/.pi/agent`, so it is a globally discovered skill location rather than an ordinary project-root `skills/` folder. Evidence: `/Users/matthias.eck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/skills.md`, `skills/learn/SKILL.md`

## Failed attempts / rejected options

- Keeping a prompt-owned learn entrypoint — rejected because the user wants the learn flow to be triggered as a real skill and orchestrated via the learn sub-agent. Evidence: `skills/learn/SKILL.md`, `agents/learn-orchestrator.md`
- Mirroring detailed task lists into `current-work.md` — rejected because the Todo Tracker should stay minimal and plans already carry execution detail when they exist. Evidence: `/Users/matthias.eck/.agents/skills/project-memory/SKILL.md`, `prompts/spec-plan-implement-review.md`

## Review findings & fixes

- The earlier learn skill draft was not aligned with the final skill contract; fixed by placing the canonical skill at `skills/learn/SKILL.md`, rewiring `agents/learn-orchestrator.md` to read the managed global skill path, and archiving the older draft outside the live skill locations.
- Tracked-work prompts did not require a minimal Todo Tracker or a guaranteed learn-orchestrator handoff; fixed across `prompts/plan.md`, `prompts/spec-plan.md`, `prompts/implement-review.md`, `prompts/plan-implement-review.md`, and `prompts/spec-plan-implement-review.md`.
- Archive-on-confirm wording did not clearly preserve the final `current-work.md` closeout state; fixed by making the prompts update `User confirmed feature complete` / `Active artifacts archived` before archiving the final snapshot.
- The learning extension still referenced `/learn review`; fixed in `extensions/learning-system/index.ts` and `extensions/learning-system/runtime.ts` for the live `/skill:learn review` trigger/guideline text.
- The earlier six-tool learning runtime surface looked potentially heavy after moving orchestration into a skill. The simplification pass now trims that to a smaller surface while keeping runtime-backed mutation safety; collapsing further into inject-only + raw skill file ops would still regress safety and UX guarantees. Evidence: `extensions/learning-system/runtime.ts`, `skills/learn/SKILL.md`, `extensions/learning-system/README.md`
- `learning-analyst` became redundant after the skill owned candidate-mining rules and `learn-orchestrator` became the dedicated extraction worker; fixed by folding the remaining analyst contract into `skills/learn/SKILL.md`, slimming `agents/learn-orchestrator.md`, and deactivating the old analyst agent file.

## Learning candidates

- Summary: Put reusable global workflows for this agent root under `skills/<name>/SKILL.md` when the repo root is also `~/.pi/agent`, instead of relying on ad hoc non-canonical skill drafts.
  - Why it matters: That keeps manual `/skill:...` triggering and explicit agent skill reads aligned with Pi's actual global discovery rules.
  - Evidence:
    - `/Users/matthias.eck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/skills.md`
    - `skills/learn/SKILL.md`
  - Candidate target: project learning
- Summary: Keep `current-work.md` Todo Trackers minimal and move detailed execution steps into the plan artifact when one exists.
  - Why it matters: It preserves restartability without duplicating or bloating the work breakdown.
  - Evidence:
    - `/Users/matthias.eck/.agents/skills/project-memory/SKILL.md`
    - `prompts/spec-plan.md`
    - `prompts/plan.md`
  - Candidate target: AGENTS.md
- Summary: Keep the learning extension runtime-backed for write/review/promotion flows; only injection should not remain as the sole extension responsibility.
  - Why it matters: The runtime still owns slugging, collision handling, scan state, managed-path guards, and promotion preview tokens that would be brittle to reimplement directly in the skill.
  - Evidence:
    - `extensions/learning-system/runtime.ts`
    - `extensions/learning-system/README.md`
    - `skills/learn/SKILL.md`
  - Candidate target: project learning
- Summary: Remove redundant domain-subagents once their contract has been absorbed by the canonical skill and the remaining worker can stay lean.
  - Why it matters: It reduces hops, duplicated instructions, and maintenance overhead without losing capability.
  - Evidence:
    - `skills/learn/SKILL.md`
    - `agents/learn-orchestrator.md`
    - `.ai/archive/deactivated/learning-analyst-agent-2026-04-17.md`
  - Candidate target: AGENTS.md
