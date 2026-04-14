# Ralph loop fresh-session update

## Goal
Default `/ralph` to a fresh Pi session/context for each iteration, while preserving an easy legacy same-session mode.

## Plan
- Inspect current `extensions/ralph-loop.ts` behavior and Pi session APIs.
- Update loop execution to create a new session per iteration by default.
- Keep abort detection, idle waiting, and status updates working.
- Preserve a low-risk legacy same-session option.
- Update inline comments/UI copy to match the new semantics.

## Progress
- [x] Reviewed current extension and Pi docs for `ctx.newSession(...)`.
- [x] Implemented fresh-session-per-iteration default.
- [x] Added a low-risk legacy same-session option.
- [x] Updated comments/UI copy.
- [x] Sanity-checked the file for TypeScript correctness.

## Notes
- Assumption: `ctx.newSession(...)` safely switches the active session from an extension command handler and returns only after the new session is active.
- Assumption: using `parentSession` is metadata only and does not restore prior chat context into the fresh iteration session.
- Verified with a follow-up review pass: no remaining correctness/API issues were found after adding the idle guard and scoped abort detection.
