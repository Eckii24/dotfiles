# Git-Root Effective CWD Review

## Outcome
- Added `extensions/git-root.ts` to resolve and cache the effective cwd as the git repo root when Pi starts inside a repo subdirectory.
- Added `extensions/git-root-cwd.ts` to reroot built-in tools, `user_bash`, the model-facing cwd prompt line, and startup session bucketing.
- Updated `extensions/guardrails/config.ts` and `extensions/guardrails/index.ts` so guardrails config lookup and path checks use the same effective cwd.

## Files Changed
- `extensions/git-root.ts`
- `extensions/git-root-cwd.ts`
- `extensions/guardrails/config.ts`
- `extensions/guardrails/index.ts`

## Validation
- Passed Bun smoke test for git-root detection, guardrails project config lookup, and root-relative allowWrite behavior.
- Passed Bun smoke test for the new extension's overridden tool registration, `session_directory` bucketing, `before_agent_start` cwd rewrite, and `user_bash` execution root.

## Limitation
- This is an extension-level effective-cwd solution. Pi core startup cwd, session header cwd, and resource-loader internals are not rewritten from this repo; a true global cwd change would need to happen in Pi itself.
