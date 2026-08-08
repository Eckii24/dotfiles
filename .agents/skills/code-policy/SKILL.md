---
name: code-policy
description: Run or maintain the personal, repository-independent ast-grep code-policy checks when the user explicitly asks to scan changed, staged, branch, or all files; or to add/test a global rule. Do not use for repository-local policy, general code review, or automatic post-edit scans.
disable-model-invocation: true
---

# Code Policy

Use only after an explicit user request.

## Scope

- Wrapper: `~/.local/bin/code-policy`
- Global config: `~/.config/code-policy/sgconfig.yml`
- Global rules: `~/.config/code-policy/rules/`
- Rule tests: `~/.config/code-policy/rule-tests/`

Run scan commands from the target Git worktree:

- changed files: `code-policy changed`
- changed files as newline-delimited JSON: `code-policy changed --json`
- staged files: `code-policy staged`
- files changed from a base: `code-policy branch <base>`
- whole current directory: `code-policy all`
- global rule tests: `code-policy test`

## Rules

- Global rules must stay path-agnostic: no repository-relative `files` or `ignores` filters.
- Repository-specific architecture policy belongs in that repository.
- Add a matching case under `rule-tests/` for every active global rule.
- Do not modify or suppress rules unless the user explicitly requests it.

## Verify

- Confirm `ast-grep` is available before changing or running policy.
- Report the exact command, exit status, and findings.
- If a scan is outside a Git worktree, state that it cannot run there; do not scan an arbitrary parent directory instead.
