# Guardrails Write Confirmation Change

## Goal
When a write/edit target is blocked because it is outside `paths.allowWrite`, ask the user for permission instead of blocking outright.

## Assumptions
- The requested behavior applies to `write` and `edit` tool calls.
- Bash already prompts for `allowWrite` violations, so this change should align direct file writes with existing bash behavior.
- `denyWrite` should continue to require confirmation as it already does.
- In non-UI contexts, operations that require confirmation must still be blocked.

## Plan
- [x] Inspect current `allowWrite` handling in `path-guard.ts` and `index.ts`
- [x] Change `checkWrite()` so `allowWrite` violations require confirmation
- [x] Update docs/comments describing current behavior
- [x] Run a small sanity check for the new result shape and messaging
- [x] Summarize change and any assumptions

## Progress Notes
- Current implementation returned `requiresConfirmation: false` for `allowWrite` misses (`allowWrite: []` and path not in allow list), which caused `index.ts` to block outright for `write`/`edit`.
- Bash guard already surfaced `allowWrite` violations as confirmable violations, so direct writes were the inconsistent case to fix.
- Updated `extensions/guardrails/path-guard.ts` so both `allowWrite: []` and non-matching `allowWrite` paths now return `requiresConfirmation: true`.
- Updated wording in `extensions/guardrails/index.ts`, `extensions/guardrails/types.ts`, and `.ai/archive/2026-03-25-guardrails-extension.md` to reflect that these writes now require confirmation rather than being hard-blocked.
- Sanity check passed with a Bun smoke test covering:
  - `allowWrite: []` → blocked result with confirmation required
  - non-matching `allowWrite` path → blocked result with confirmation required
  - `allowWrite: undefined` → still allowed without confirmation
