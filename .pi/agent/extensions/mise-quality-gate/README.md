# mise quality gate

Deterministic Pi quality gate for repositories that expose a mise task contract.

```text
Pi agent_end
  -> Git reports changed paths
  -> resolved mise policy matches paths
  -> mise run verify from Git root
  -> format -> lint -> build -> unit tests
```

Pi decides **when** to run a gate. mise decides **which checks** `verify` runs.
The LLM never decides whether the gate should run.

## Activation contract

The extension enables itself once at `session_start` only when all conditions hold:

1. Current directory is inside a Git repository.
2. `mise` is available.
3. The protected global mise task `pi:quality-gate:project-root` resolves the Git root.
4. `mise env --json` at that root resolves a valid `PI_QUALITY_GATE_INCLUDE` policy.
5. The resolved mise hierarchy defines `format`, `lint`, `build`, and `test`.
6. The resolved mise hierarchy defines `verify`.

The global config owns the protected resolver plus fail-closed diagnostic tasks. Stack defaults live in directory-level configs, for example `~/Development/Repos/mise.toml` for .NET repositories. Pi runs tasks with the resolved Git root as `cwd`; each task uses `MISE_ORIGINAL_CWD` so stack helpers resolve the current repository, including nested `src/v<N>` layouts.

Before Pi executes the resolver, it verifies that its source is exactly `~/.config/mise/config.toml`. Quality tasks may come from a trusted parent stack config or a trusted repository-local override. Global quality-task fallbacks are diagnostics only and are rejected as a gate contract.

The Pi UI shows the resulting state, for example:

```text
Quality gate: enabled — /work/widget
Quality gate: disabled — missing or invalid PI_QUALITY_GATE_INCLUDE
Quality gate: disabled — quality task format is unavailable
```

Every stack config must be trusted by mise. Parent configs are intentional and inherited by all repositories below them. Inspect and trust the reviewed stack config explicitly:

```zsh
mise trust --show
mise trust ~/Development/Repos/mise.toml
```

## .NET example setup

The global config contains the protected resolver and fail-closed diagnostics:

```text
~/.config/mise/config.toml
```

Shared .NET defaults live in the directory config inherited by repositories below `~/Development/Repos`:

```text
~/Development/Repos/mise.toml
```

The file may be a symlink to the reusable template:

```zsh
ln -s ~/.config/mise/templates/dotnet/mise.toml ~/Development/Repos/mise.toml
mise trust ~/Development/Repos/mise.toml
```

The stack config defines:

```text
format             dotnet-in-repo format --verify-no-changes
format:apply       dotnet-in-repo format
lint               dotnet-in-repo format analyzers --verify-no-changes
build              dotnet-in-repo build
test               dotnet-in-repo test-kind unit
test:integration   dotnet-in-repo test-kind integration
```

`verify` runs `format`, `lint`, `build`, and `test` serially. `verify:full` adds `test:integration`.

The gate never installs mise tools, SDKs, or .NET automatically:

```text
MISE_TASK_RUN_AUTO_INSTALL=false
```

## Trigger policy

Each stack config owns its trigger policy. Pi reads the resolved values from the active mise hierarchy:

```zsh
mise env --json
```

Required variable:

```toml
[env]
PI_QUALITY_GATE_INCLUDE = '''
["**/*.cs", "**/*.csproj"]
'''
```

Optional variable:

```toml
[env]
PI_QUALITY_GATE_EXCLUDE = '''
["**/bin/**", "**/obj/**"]
'''
```

Values are JSON arrays encoded as TOML strings because mise environment values are strings.

The .NET stack policy includes source, project, MSBuild, solution, `.editorconfig`, NuGet, lockfile, and `global.json` changes. It excludes generated `bin` and `obj` trees.

A Python stack can provide a sibling config, for example `~/Development/Python/mise.toml`, with Python-specific policy and tasks. A repository-local `mise.toml` can override inherited stack tasks after explicit trust.

## Change detection

At every `agent_end`, Pi reads the union of:

```text
git diff --name-only -z
git diff --cached --name-only -z
git ls-files --others --exclude-standard -z
```

Every resulting Git-relative path is matched against the resolved include and exclude globs.

```text
matching changed path   -> mise run --jobs 1 verify
only non-matching paths -> no quality gate
```

This is intentionally conservative. A `.cs` file already dirty before the agent started still triggers the gate. Better one extra verification than silently missing a mutation made by Pi, Bash, Python, or another tool.

## Lifecycle and failure handling

- At most one gate runs per `agent_end`.
- While it runs, Pi shows `Running mise verify…` in the UI.
- `verify` has a ten-minute timeout.
- On success, Pi shows `Quality gate passed`.
- On failure, Pi shows the failed paths and a compact diagnostic, then queues one automatic Pi follow-up asking the LLM to repair the failure in current scope.
- Only one automatic repair handoff is queued per Pi session. This prevents a permanently failing test from creating an infinite agent loop.

Before diagnostics reach either the UI or LLM follow-up, common credential forms are redacted, including Authorization headers, password/token/key assignments, connection-string assignments, and common GitHub/GitLab/OpenAI token shapes.

Redaction is defense in depth, not a complete secret-scanning guarantee. Commands should still avoid printing credentials.

## Troubleshooting

```zsh
# Inspect resolved shared policy from any repository directory.
mise env --json

# Resolve the current Git root through the protected contract.
mise run --quiet pi:quality-gate:project-root

# Inspect resolved task origins; source may be a trusted stack or repo config.
mise tasks info --json format
mise tasks info --json lint
mise tasks info --json build
mise tasks info --json test
mise tasks info verify

# Validate task graph without running checks.
mise tasks validate

# Run the same default gate manually.
mise run --jobs 1 verify

# Run integration tests too.
mise run --jobs 1 verify:full
```

## Non-goals

- No automatic SDK, runtime, or tool installation.
- No formatting mutation during the automatic gate.
- No integration tests in default `verify`.
- No per-repository task duplication when stack defaults are sufficient.
