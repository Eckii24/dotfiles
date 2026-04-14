# Current Work

> This file is the operational source of truth for exactly one active feature. When the next feature starts, replace the feature-specific sections but keep the structure.

## Active Feature
- **Slug**: `ralph-loop-iteration-reset`
- **Title**: Make Ralph loop iteration boundaries and early-stop behavior reliable
- **Status**: Completed
- **Started**: 2026-03-28
- **Last updated**: 2026-03-28

## Objective
- Re-review `extensions/ralph-loop.ts` to confirm the first submitted prompt is treated as iteration 1 exactly once.
- Ensure fresh-session looping cleanly restarts each iteration instead of double-sending or drifting iteration state.
- Verify whether an existing structured done signal already exists and, if so, let Ralph stop early when it is emitted.

## Current Step
- Ralph's per-iteration control message is now visible to the user instead of hidden.
- The loop-start race fix remains in place.
- `[RALPH_DONE]` is still both communicated to the model and checked by the extension.

## Evolving Plan
1. ✅ Inspect the current Ralph loop code and relevant Pi APIs.
2. ✅ Confirm iteration-one / fresh-session behavior from the code paths.
3. ✅ Check whether a structured done signal already exists in this repo or Pi APIs.
4. ✅ Patch `extensions/ralph-loop.ts` to inspect per-iteration outcomes and stop early on an explicit done marker.
5. ✅ Fix the loop-start race so the next iteration actually begins.
6. ✅ Inject a short per-iteration control prompt that explains the Ralph loop and how to end early with `[RALPH_DONE]`.
7. ✅ Make that control prompt visible to the user as well.
8. ✅ Run a focused sanity check / import test.
9. ✅ Update current-work with the outcome.

## Relevant Files
- `.ai/current-work.md`
- `extensions/ralph-loop.ts`
- `extensions/dirty-repo-guard.ts`
- Archived Ralph artifacts in `.ai/archive/`

## Linked Artifacts
- `.ai/archive/2026-03-25-ralph-loop-fresh-session.md`
- `.ai/archive/2026-03-26-ralph-loop-followup-fix.md`
- `.ai/archive/2026-03-26-dirty-repo-guard-ralph-fix.md`

## Open Questions / Blockers
- No open blockers.

## Parking Lot
- If a Pi-wide structured completion signal is added later, Ralph should switch to that instead of its local marker.

## Assumptions
- Visible custom messages (`pi.sendMessage(..., { display: true })`) still participate in model context before the visible loop prompt. This matches Pi's documented `CustomMessageEntry` behavior while making Ralph's control instructions explicit to the user.

## Completion Handoff
- `/ralph <prompt>` still treats the prompt passed to the command as iteration 1; the loop does not intentionally send an extra first prompt.
- Fresh-session mode still creates a clean `ctx.newSession(...)` before each iteration, so each loop starts from a reset Pi chat context.
- Fixed the core loop regression: Ralph now waits for each extension-injected prompt to actually begin before awaiting idle, avoiding the fire-and-forget race that could leave the loop stuck after the first LLM completion.
- No existing structured Ralph done/completion signal was found in this repo or the inspected Pi APIs.
- Ralph now injects a visible per-iteration control message telling both the model and the user that it is in a Ralph loop, whether the session is fresh or reused, and that `[RALPH_DONE]` ends the loop early only when the task is truly complete.
- Ralph still supports deterministic early exit when the assistant emits `[RALPH_DONE]` in the latest assistant text for an iteration.
- Sanity check passed: `NODE_PATH=/Users/matthias.eck/.cache/.bun/install/global/node_modules bun -e "await import('./ralph-loop.ts'); console.log('ralph-loop-ok')"`
