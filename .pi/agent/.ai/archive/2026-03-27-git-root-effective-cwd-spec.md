# Git-Root Effective CWD Spec

## Goal
When Pi starts in a subdirectory of a git repository, treat the repository root as the effective working directory for repo-scoped behavior implemented in this repo.

## Requirements
- If the startup cwd is inside a git worktree, compute the repository root and use it as the effective cwd.
- If the startup cwd is not inside a git worktree, keep the original cwd.
- Guardrails must resolve relative paths, `./**` allowlists, and `.pi/guardrails.json` project config from the effective cwd.
- Built-in file and shell tools overridden from this repo must execute relative to the effective cwd.
- `!` user bash commands should also execute relative to the effective cwd.
- The model-facing system prompt should report the effective cwd so tool descriptions and prompt context stay consistent.
- Startup session directory selection should key off the effective cwd so sessions started from repo subdirectories share the same bucket.

## Constraints
- This repo can only change behavior through extensions and supporting utilities; it cannot rewrite Pi core startup cwd or resource-loader internals.
- Existing non-git-directory behavior must stay unchanged.
- The solution should avoid repeated `git rev-parse` calls where possible.

## Acceptance Criteria
- Starting Pi in a git repo subdirectory uses the repo root as the effective cwd for tool execution and guardrail checks.
- Starting Pi outside git behaves exactly as before.
- Guardrails with `allowWrite: ["./**"]` allow writes anywhere in the repo when launched from a repo subdirectory.
- Session directory resolution for startup uses the repo root bucket when rerooted.
- The implementation clearly documents the extension-level limitation: true core cwd replacement would require Pi changes outside this repo.
