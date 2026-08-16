# mise quality gate

Deterministic Pi quality gate for repositories that expose a mise task contract.

```text
Pi agent_end
  -> Git reports changed paths
  -> project mise policy matches paths
  -> mise run verify
  -> format -> lint -> build -> unit tests
```

Pi decides **when** to run a gate. mise decides **which checks** `verify` runs.
The LLM never decides whether the gate should run.

## Activation contract

The extension enables itself once at `session_start` only when all conditions hold:

1. Current directory is inside a Git repository.
2. `mise` is available.
3. The protected global mise task `pi:quality-gate:project-root` resolves a project root inside that Git repository.
4. `mise env --json` at that root resolves a valid `PI_QUALITY_GATE_INCLUDE` policy.
5. The repository defines `format`, `lint`, `build`, and `test` tasks in a mise config file inside that repository.
6. `verify` is resolvable.

Global fallback tasks do **not** satisfy condition 5. This prevents accidentally running an arbitrary stack in a repository without an explicit local quality policy.

Before Pi executes `pi:quality-gate:project-root`, it verifies that the task's source is exactly `~/.config/mise/config.toml`. A repository-local override disables the gate instead of running project-provided discovery code during session startup.

The Pi UI shows the resulting state, for example:

```text
Quality gate: enabled — /work/widget/src/v2
Quality gate: disabled — missing or invalid PI_QUALITY_GATE_INCLUDE
Quality gate: disabled — task format is not defined in this repository
```

A project `mise.toml` must be trusted by mise. If it is not trusted, `mise env --json` cannot resolve the policy and the gate remains disabled. Trust the reviewed project config explicitly:

```zsh
mise trust mise.toml
```

## .NET example setup

The extension is stack-agnostic. This repository includes a .NET template as one example. Global generic task orchestration lives in:

```text
~/.config/mise/config.toml
```

It provides `pi:quality-gate:project-root`, `verify`, and `verify:full`. The protected resolver prints mise's `MISE_PROJECT_ROOT`; leaf tasks intentionally fail closed until a project defines them.

Copy the .NET template into the project or wrapper root:

```zsh
cp ~/.config/mise/templates/dotnet/mise.toml ./mise.toml
mise trust mise.toml
```

The template defines:

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

The project owns trigger policy through normal mise environment inheritance. Pi reads the resolved values from:

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

The shipped .NET template includes source, project, MSBuild, solution, `.editorconfig`, NuGet, lockfile, and `global.json` changes. It excludes generated `bin` and `obj` trees.

mise resolves parent and nested `mise.toml` files. A nested project behaves as follows:

```text
PI_QUALITY_GATE_INCLUDE absent  -> inherit parent value
PI_QUALITY_GATE_INCLUDE present -> replace parent list completely
PI_QUALITY_GATE_EXCLUDE absent  -> inherit parent value
```

Complete replacement is deliberate: a subproject can narrow or replace its trigger surface without Pi implementing another config merge system.

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
# Inspect resolved policy at the project or wrapper root.
mise env --json

# Resolve project root through the protected generic contract.
mise run --quiet pi:quality-gate:project-root

# Inspect task origin; leaf tasks must originate inside the repository.
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
- No stack-specific task implementation; projects own `format`, `lint`, `build`, `test`, and `verify`.
