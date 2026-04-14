# Dirty-repo-guard / Ralph compatibility fix

## Goal
Stop `dirty-repo-guard` from prompting on every Ralph-created fresh session, while preserving the dirty-repo confirmation for normal manual session changes.

## Plan
- Replace the stock example `dirty-repo-guard` package entry with a repo-local extension.
- Add a small inter-extension bypass signal that Ralph can enable only while a fresh-session loop is active.
- Keep the original dirty-repo confirmation behavior for normal `/new`, `/resume`, and `/fork` flows.
- Sanity-check the updated extension wiring and document the assumption.

## Progress
- [x] Confirmed `settings.json` currently loads the stock example `dirty-repo-guard.ts` from the pi package examples.
- [x] Confirmed `extensions/ralph-loop.ts` now uses `ctx.newSession(...)` for fresh-session iterations, which triggers `session_before_switch` each loop.
- [x] Added repo-local `extensions/dirty-repo-guard.ts` with Ralph-aware bypass handling.
- [x] Updated `extensions/ralph-loop.ts` to bracket fresh-session loops with bypass start/stop events.
- [x] Removed the stock example `dirty-repo-guard.ts` package path from `settings.json`.
- [x] Sanity-checked the resulting files with `NODE_PATH=/Users/matthias.eck/.cache/.bun/install/global/node_modules bun -e "await import('./extensions/dirty-repo-guard.ts'); await import('./extensions/ralph-loop.ts'); console.log('extensions-ok')"`.

## Result
- Normal dirty-repo prompts remain in place for manual session switches and forks.
- Ralph fresh-session loops now emit a temporary bypass token so the dirty-repo guard does not prompt on every loop iteration.
- The repo now uses a local `extensions/dirty-repo-guard.ts` instead of the stock example package entry, so this behavior is maintained inside `~/.pi/agent`.

## Assumption
- The intended fix is to suppress dirty-repo prompts only for Ralph-managed fresh-session iteration switches, not to weaken dirty-repo prompts for normal manual session changes.
