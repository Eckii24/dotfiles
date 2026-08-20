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
3. The protected global mise task `pi:quality-gate:project-root` resolves the Pi session directory.
4. `mise env --json` at that root resolves a valid `PI_QUALITY_GATE_INCLUDE` policy.
5. The resolved mise hierarchy defines `format`, `lint`, `build`, and `test`.
6. The resolved mise hierarchy defines `verify`.

The global config owns the protected resolver plus fail-closed diagnostic tasks. Stack defaults live in directory-level configs, for example `~/Development/Repos/mise.toml` for .NET repositories. Pi runs tasks with the resolved Pi session directory as `cwd`; each task uses `MISE_ORIGINAL_CWD` so stack helpers resolve the requested project, including components nested in a Git monorepo and `src/v<N>` layouts.

Before Pi executes the resolver, it verifies that its source is exactly `~/.config/mise/config.toml`. Quality tasks may come from a trusted parent stack config or a trusted repository-local override. Global quality-task fallbacks are diagnostics only and are rejected as a gate contract.

At session start, the extension reports the resulting state, without project path or configuration details:

```text
[quality-gate] Quality gate: enabled
[quality-gate] Quality gate: disabled — not inside a Git repository
```

Use `/quality-gate status` for details during a session.

## Session controls

Disable the gate when starting Pi:

```zsh
pi --no-quality-gate
```

Set any Mise task as its target when starting Pi:

```zsh
pi --quality-gate-task verify:full
```

Control it from Pi chat for the current session:

```text
/quality-gate
/quality-gate status
/quality-gate enable
/quality-gate disable
/quality-gate configure task verify:full
/quality-gate configure attempts 2
/quality-gate reset
/quality-gate help
```

The default target is `verify`. `--no-quality-gate` starts the session disabled; `/quality-gate enable` re-checks the activation contract before enabling it. `configure task <name>` accepts any non-empty Mise task name, but it must resolve from a trusted repository or parent stack config. All command settings are session-only.

### Settings

Set defaults globally in `~/.pi/agent/settings.json`, or per repository in `.pi/settings.json`. Project settings override global fields independently:

```json
{
  "qualityGate": {
    "task": "verify:full",
    "maxRepairAttempts": 2
  }
}
```

- `task`: default Mise task. Falls back to `verify`.
- `maxRepairAttempts`: non-negative count of failed gate runs that queue an automatic repair follow-up for the model. Falls back to `1`; `0` disables automatic repair follow-ups.
- `/quality-gate configure task <name>` and `/quality-gate configure attempts <count>` override these defaults for the active session.
- `/quality-gate reset` removes both session overrides and restores current settings defaults.
- `/quality-gate` shows current state and compact navigation; `/quality-gate help` shows the full syntax.

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
- While it runs, the footer shows `Quality gate: running <task>`; the status clears when the gate finishes. Failures and successes still notify in the UI.
- `verify` has a ten-minute timeout.
- On success, Pi shows `Quality gate passed`.
- On failure, Pi shows the failed paths and a compact diagnostic, then queues one automatic Pi follow-up asking the LLM to repair the failure in current scope.
- Failed checks queue automatic repair follow-ups only up to `maxRepairAttempts` (default: one). This prevents a permanently failing test from creating an infinite agent loop.

Before diagnostics reach either the UI or LLM follow-up, common credential forms are redacted, including Authorization headers, password/token/key assignments, connection-string assignments, and common GitHub/GitLab/OpenAI token shapes.

Redaction is defense in depth, not a complete secret-scanning guarantee. Commands should still avoid printing credentials.

## Troubleshooting

```zsh
# Inspect resolved shared policy from any repository directory.
mise env --json

# Resolve the current Pi session directory through the protected contract.
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
