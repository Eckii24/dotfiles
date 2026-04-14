# Guardrails Reload Fix

## Goal
Make guardrails config reload behavior explicit and robust so changes in `guardrails.json` are actually picked up and users get visible feedback.

## Assumptions
- The user expects `/reload` to re-read `~/.pi/agent/guardrails.json` and apply the latest rules.
- Even if Pi already re-emits `session_start` on `/reload`, the extension should not rely only on startup-time config loading for correctness.

## Plan
- [x] Inspect current guardrails reload/config loading behavior
- [x] Implement a minimal robust reload strategy
- [x] Add explicit reload/startup notification text
- [x] Sanity-check behavior

## Progress Notes
- Current code loads config only in `session_start`, storing it in memory for later tool calls.
- Pi runtime does emit `session_start` on `/reload`, so config should be re-read then, but the notification text did not explicitly indicate that config was read from disk.
- Implemented mtime-based config caching in `extensions/guardrails/config.ts`, so the extension now re-reads config whenever the file changes while remaining cheap to call frequently.
- `extensions/guardrails/index.ts` now refreshes config for every tool call and for `/guardrails`, so updated rules apply even without relying solely on `/reload`.
- Startup notification and `/guardrails` output now show which config source files are active.
- Sanity checks passed:
  - Bun import smoke test for `config.ts` and `index.ts`
  - temp-directory test confirmed changed project config file is picked up on the next `loadConfig()` call
