# code-policy

Personal, repository-independent ast-grep policy baseline.

## Usage

The `code-policy` wrapper uses `~/.config/code-policy/sgconfig.yml` and must be run from the target Git worktree for Git-based scans:

- `code-policy changed` — scan staged and unstaged files changed from `HEAD`
- `code-policy changed --json` — emit newline-delimited JSON for changed files
- `code-policy staged` — scan files staged in the Git index
- `code-policy branch <base>` — scan files changed from `<base>...HEAD`
- `code-policy all` — scan the current directory
- `code-policy test` — run the central ast-grep rule tests

`ast-grep` must be installed and available on `PATH`. The repository quality gate invokes `code-policy changed` through Mise.

## Rules

- `sgconfig.yml` is always selected explicitly by `code-policy` and Neovim.
- Global rules must be path-agnostic: no repository-relative `files` or `ignores` filters.
- Repository architecture policy belongs in that repository, not here.
- Add a matching case under `rule-tests/` for every active rule.
- Do not modify or suppress rules unless explicitly requested.

The initial scaffold intentionally has no active rules. Add a rule only after its desired semantics and false-positive boundary are explicit.
