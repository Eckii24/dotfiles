# code-policy

Personal, repository-independent ast-grep policy baseline.

- `sgconfig.yml` is always selected explicitly by `code-policy` and Neovim.
- Rules must be path-agnostic: no repository-relative `files` or `ignores` filters.
- Repository architecture policy belongs in that repository, not here.
- Add a matching case under `rule-tests/` for every active rule.

The initial scaffold intentionally has no active rules. Add a rule only after its desired semantics and false-positive boundary are explicit.
