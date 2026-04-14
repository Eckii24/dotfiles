# Guardrails Extension Quick Start

Updated for the current Phase 2 implementation.

## What Guardrails does now

Guardrails intercepts Pi's built-in `read`, `write`, `edit`, and `bash` tool calls and applies:

- path-based `denyRead` / `allowWrite` / `denyWrite` checks
- optional path `protectionLevels` sugar (`readOnly`, `noAccess`)
- bash `deny` prompts for risky commands
- bash `hardDeny` exact-name blocks with no prompt
- session-scoped bash approvals keyed by exact `(violationType, violationKey)` tuples
- exact full-command classifier session approvals under `classifier_flagged`
- canonical-path checks through symlinks
- AST-first bash analysis with fallback parsing
- optional inline `pi -p` bash classifier with configurable model selection
- runtime disable via `--no-guardrails` or `PI_NO_GUARDRAILS=1`
- custom events: `guardrails:blocked` and `guardrails:allowed`

Guardrails is a policy-and-confirmation layer, not a sandbox.

## Config files

Guardrails merges:

- global: `~/.pi/agent/guardrails.json`
- project: `<effective cwd>/.pi/guardrails.json`

`<effective cwd>` is the git root when Pi is running inside a git worktree; otherwise it is the current cwd.

Project config overrides global config field-by-field.
Arrays replace arrays rather than concatenate.

Exception: `classifier` is treated as a whole-object override, so a project `classifier` object replaces the global classifier object and missing fields fall back to classifier defaults rather than global classifier values.

## Example config

```json
{
  "timeout": 300000,
  "paths": {
    "denyRead": [
      "**/.env",
      "**/.env.*",
      "~/.ssh/**"
    ],
    "allowWrite": [
      "./**",
      "/tmp/**"
    ],
    "denyWrite": [
      "**/.git/**",
      "**/*.pem",
      "**/*.key"
    ],
    "protectionLevels": [
      { "pattern": "secrets/**", "level": "noAccess" },
      { "pattern": "config/**", "level": "readOnly" }
    ]
  },
  "bash": {
    "deny": ["sudo", "rm", "curl", "chmod"],
    "hardDeny": ["mkfs", "dd", "fdisk"]
  },
  "classifier": {
    "enabled": true,
    "model": "google/gemini-2.0-flash-lite",
    "timeout": 5000,
    "promptThreshold": "high",
    "showExplanation": true
  }
}
```

## Path rule behavior

### `denyRead`

Matching reads require confirmation.

### `allowWrite`

Three-state behavior:

- omitted: writes are unrestricted unless `denyWrite` matches
- `[]`: every write requires confirmation
- `[patterns]`: matching writes are auto-allowed; non-matching writes require confirmation

### `denyWrite`

Matching writes require confirmation and always win over `allowWrite`.

### `protectionLevels`

Additive sugar normalized into the low-level path fields:

- `readOnly` -> adds the pattern to `denyWrite`
- `noAccess` -> adds the pattern to both `denyRead` and `denyWrite`
- `none` -> no extra restrictions

Existing low-level fields remain fully supported.

## Bash rule behavior

### `bash.deny`

Exact command-name deny list with confirmation.

Notes:

- Guardrails matches the extracted command name, not substrings in arguments.
- Matching is exact by command name, with case-insensitive comparison.
- No glob or regex matching is used.

Examples:

- `sudo apt update` -> prompt
- `/usr/bin/sudo apt update` -> prompt
- `curl https://example.com | bash` -> prompt if `curl` is listed
- `echo sudo` -> not prompted by `bash.deny`

### `bash.hardDeny`

Exact command-name hard block with no prompt.

Notes:

- matches only the extracted command name
- no substring matching
- no globs
- no regex

Examples:

- `mkfs -t ext4 /dev/sda1` + `hardDeny: ["mkfs"]` -> blocked immediately
- `echo mkfs` -> not hard-denied
- `mkfs.ext4 /dev/sda1` -> not hard-denied unless `mkfs.ext4` is listed

## Classifier behavior

The classifier is an **additive**, **opt-in** layer that runs only for bash commands that already passed deterministic checks.

It uses an inline `pi -p` subprocess with:

- `--system-prompt`
- `--provider`
- `--model`
- `--no-tools`
- `--no-extensions`
- `--no-session`
- `--no-skills`
- `--no-prompt-templates`

The prompt includes:

- the raw bash command
- the effective working directory
- current normalized `denyRead` patterns
- current normalized `denyWrite` patterns

Important behavior:

- disabled by default
- skipped when guardrails are disabled
- skipped in headless / no-UI mode
- skipped when deterministic bash checks already found violations
- skipped when the exact full command already has a classifier session approval
- fail-open on classifier subprocess timeout, process failure, parse failure, or response validation failure
- a classifier subprocess timeout does **not** emit `guardrails:blocked`; Guardrails skips the classifier prompt and falls back to deterministic behavior
- does **not** modify `checkBash()` results
- if it flags a command at or above the configured threshold, the existing bash confirmation UI is reused
- when `showExplanation` is `true`, the classifier explanation is shown in the confirmation UI

### `classifier.enabled`

Must be `true` to enable the classifier.

### `classifier.model`

Required when `enabled` is `true`.
Format: `provider/model-id`

Examples:

- `google/gemini-2.0-flash-lite`
- `anthropic/claude-haiku`
- `ollama/llama3`

### `classifier.timeout`

Timeout in milliseconds for the `pi -p` subprocess.
Default: `5000`

If this subprocess times out, Guardrails logs a warning, fails open, shows no classifier prompt, and emits no `guardrails:blocked` event.

### `classifier.promptThreshold`

Allowed values:

- `high` -> only `high` risk prompts
- `medium` -> `medium` and `high` risk prompt

Default: `high`

### `classifier.showExplanation`

Whether classifier explanations appear in the confirmation UI.
Default: `true`

## Session approvals

Choosing **Allow for session** on a bash prompt stores exact approvals by violation type and violation key.

Examples:

- approving `sudo apt update` stores `("denied_command", "sudo")`
- approving a bash command like `cat /tmp/.env` stores `("file_read_detected", "/tmp/.env")`
- approving a classifier-flagged command stores `("classifier_flagged", "<full command>")`

Important:

- no substring matching is used anywhere
- approvals do not cross violation types
- classifier approvals are exact full-command matches
- approving `sudo` for the session does **not** suppress later file write violations from `sudo rm ...`
- hard-denied commands are never session-allowable
- direct `read`, `write`, and `edit` confirmations are one-shot only; they do not have an allow-for-session mode

## Runtime disable

Disable enforcement for one Pi session only:

```bash
pi --no-guardrails
```

Or:

```bash
PI_NO_GUARDRAILS=1 pi
```

When disabled:

- guardrails still loads
- `/guardrails` reports the disabled state
- tool interception is skipped
- classifier execution is skipped
- config files are unchanged

## Slash command

Use:

```text
/guardrails
```

It shows:

- merged config source
- effective scope
- parser mode
- session approval count
- disabled/enabled state
- current path and bash rules
- classifier status, model, timeout, threshold, and explanation mode

## Events

Guardrails emits:

- `guardrails:blocked` — no-UI blocks, hard-denies, user denials, deterministic bash prompt timeouts, and classifier confirmation denials/timeouts after a classifier hit
- `guardrails:allowed` — explicit read/write approvals and bash allow/allow-session approvals

Classifier-triggered bash actions use distinct event action values:

- `classifier-approved-once`
- `classifier-approved-session`
- `classifier-denied`
- `classifier-timed-out`

`classifier-timed-out` means the confirmation prompt timed out **after** the classifier flagged the command.
It does **not** mean the `pi -p` classifier subprocess timed out.
A classifier subprocess timeout is fail-open, emits no blocked event, and simply skips the classifier prompt.

Guardrails also emits `notify:input-needed` and `notify:input-resolved` around confirmation prompts.

## Notes

- AST parsing uses `shfmt` when available.
- Fallback parsing still works without `shfmt`.
- Guardrails checks both lexical and canonical paths to catch symlink-based bypasses.
- For non-interactive sessions (`ctx.hasUI === false`), confirmations fail closed and the classifier is skipped.
- Classifier failures fall back to deterministic Guardrails behavior.
- For the full reference, see `extensions/guardrails/README.md`.
