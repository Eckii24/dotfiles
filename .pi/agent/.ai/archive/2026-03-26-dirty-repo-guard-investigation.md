# Dirty Repo Guard Investigation — 2026-03-26

## Context
- Bead: `agent-bxd.1`
- User report: dirty git repo guard "does not work anymore"
- Clarification: user means the Pi extension behavior; current symptom is "does nothing / no longer blocks"

## Memory / prior artifacts checked
- `.ai/archive/2026-03-26-dirty-repo-guard-ralph-fix.md`
- `.ai/archive/2026-03-25-guardrails-extension.md`
- `.ai/archive/2026-03-25-guardrails-reload-fix.md`
- `extensions/dirty-repo-guard.ts`
- `extensions/ralph-loop.ts`
- `settings.json`
- Pi docs: `docs/extensions.md`, `docs/rpc.md`

## What I verified

### 1) The current dirty-repo guard extension is present and auto-discovered
- File: `extensions/dirty-repo-guard.ts`
- Pi docs confirm auto-discovery from `~/.pi/agent/extensions/*.ts` and `.../*/index.ts`.
- `settings.json` does not need to list this file explicitly.

### 2) Direct session switching still triggers the guard
I reproduced this in a temporary dirty git repo using Pi RPC mode and the explicit RPC command:
- command: `new_session`
- observed behavior:
  - Pi emitted an `extension_ui_request` with `method: "select"`
  - title: `You have 1 uncommitted file(s). new session anyway?`
  - after cancelling that dialog, Pi returned:
    - `{"type":"response","command":"new_session","data":{"cancelled":true}}`

Conclusion:
- `session_before_switch` still fires for direct `new_session`
- `extensions/dirty-repo-guard.ts` is functional on that path

### 3) Sending `/new` as a normal prompt does NOT execute the built-in new-session flow
I also tested Pi RPC mode by sending:
- `{"type":"prompt","message":"/new"}`

Observed behavior:
- Pi treated `/new` as a normal user message and started an agent turn
- no dirty-repo prompt was shown
- this matches Pi docs:
  - `docs/extensions.md` notes that built-in interactive commands are not part of `get_commands` and would not execute if sent via `prompt`
  - `docs/rpc.md` documents `new_session`, `switch_session`, and `fork` as dedicated RPC commands

Conclusion:
- if a client / host / IDE integration sends `/new` as plain prompt text instead of using the dedicated session RPC command, the dirty-repo guard will appear to "do nothing"
- in that case the bug is likely in the caller/integration path, not in `extensions/dirty-repo-guard.ts`

## User follow-up
- The failing case is launching a fresh session from the terminal with `pi`
- Requested behavior: guard initial startup too, while keeping `ralph-loop` working
- Prior Ralph compatibility context remains relevant: `.ai/archive/2026-03-26-dirty-repo-guard-ralph-fix.md`

## Implementation decision
- Add startup guarding in `extensions/dirty-repo-guard.ts` via `session_start`
- Keep Ralph compatibility by leaving the existing bypass on `session_before_switch(reason === "new")`
- Rationale: `AgentSession.newSession()` emits `session_before_switch` / `session_switch`, not `session_start`, so Ralph's repeated fresh-session loop stays unaffected

## Assumption
- "Starting a fresh session from the terminal using `pi`" means initial interactive startup into a brand-new session, not resuming an existing conversation.
- To avoid bothering normal restarts into existing conversations, the startup prompt should only run when the current branch has no message entries yet.

## Progress
- [x] Reproduced that direct `new_session` still triggers the guard
- [x] Confirmed prompt text like `/new` is not the same path as direct session RPC commands
- [x] Confirmed the user actually wants initial terminal startup guarded
- [x] Implemented startup guarding in `extensions/dirty-repo-guard.ts`
- [x] Kept Ralph compatibility by leaving bypass logic scoped to `session_before_switch(reason === "new")`
- [x] Smoke-checked TypeScript imports with Bun
- [x] Smoke-checked that dirty startup now emits a startup confirmation prompt in RPC mode
