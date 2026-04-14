# Git-Root Effective CWD Plan

## Tasks
1. Add a shared helper that maps an arbitrary cwd to its effective cwd (git root when present, otherwise original cwd) with caching.
2. Update `extensions/guardrails/` to use the effective cwd for config lookup, path checks, and command analysis.
3. Add a new extension that overrides built-in tools and `user_bash` so execution uses the effective cwd.
4. Update model-facing prompt/session behavior via extension hooks so startup sessions and prompt text reflect the effective cwd as much as the extension API allows.
5. Run smoke tests for helper behavior, tool delegation behavior, and guardrail path/config resolution.

## Expected Files
- `extensions/git-root-cwd.ts`
- `extensions/git-root.ts`
- `extensions/guardrails/index.ts`
- `extensions/guardrails/config.ts`
- Possibly `extensions/guardrails/path-guard.ts` if helper use belongs there

## Evals
- `bun` smoke test confirming git-root helper returns repo root for a nested temp repo and passthrough for non-git directories.
- `bun` smoke test confirming `getConfigPaths()` and `checkWrite()` behave relative to the effective cwd.
- Review pass confirming the extension API limitation is noted in the final summary.
