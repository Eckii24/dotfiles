# Guardrails Extension — Implementation Plan

## Status: ✅ Complete

## Overview
A Pi extension that provides configurable security guardrails for tool invocations (read, write, edit, bash).

## Config
- **Location**: `~/.pi/agent/guardrails.json` (global) + `.pi/guardrails.json` (project-local, takes precedence)
- **Format**: JSON with deep merge (project overrides global)

### Config Schema
```json
{
  "timeout": 300000,
  "paths": {
    "denyRead": ["**/.env", "**/.env.*", "~/.ssh/**", "~/.aws/**"],
    "allowWrite": ["./**", "/tmp/**"],
    "denyWrite": ["**/.env", "**/.env.*", "**/node_modules/**", "**/.git/**"]
  },
  "bash": {
    "deny": ["rm", "sudo", "chmod", "chown", "mkfs", "dd", "shutdown", "reboot"]
  }
}
```

## Rules

### Read Guard (`denyRead`)
- Intercepts `read` tool calls
- If path matches a `denyRead` glob pattern → ask for confirmation with configurable timeout
- Timeout default: 5 minutes (300000ms). On timeout → block with message to agent
- No denyRead entries = all reads allowed

### Write Guard (`allowWrite` + `denyWrite`)
- Intercepts `write` AND `edit` tool calls
- Path must match at least one `allowWrite` pattern to be auto-permitted
- Even if allowed, `denyWrite` always wins (deny takes precedence)
- If blocked by deny → ask for confirmation with timeout (same as read)
- If blocked by not in allow → ask for confirmation instead of blocking outright
- If `allowWrite` is not set / undefined → no allowWrite restriction (only denyWrite applies)

### Bash Guard
- Intercepts `bash` tool calls
- **Command parsing**: Splits complex bash into individual commands
  - Handles: `&&`, `||`, `;`, `|`, newlines
  - Handles: subshells `(...)`, command substitution `$(...)`
  - Handles: `bash -c "..."`, `sh -c "..."`, `eval "..."`
  - Handles: env var prefixes (`VAR=val cmd`), command prefixes (`nice`, `nohup`, `time`, `env`)
  - Handles: `sudo cmd`, `exec cmd`, `xargs cmd`
  - Handles: full path commands (`/usr/bin/rm` → checks `rm`)
- **Deny list**: Each extracted command name checked against `bash.deny`
- **File operation detection**: Also checks for:
  - Output redirections (`>`, `>>`) targeting denyWrite paths
  - `cp`, `mv`, `install`, `ln`, `rsync`, `scp` targeting denyWrite paths
  - `tee` writing to denyWrite paths
  - `dd of=path` writing to denyWrite paths
- On match → ask for confirmation with timeout

## File Structure
```
~/.pi/agent/extensions/guardrails/
├── index.ts           # Extension entry point, event handlers
├── config.ts          # Config loading, merging, validation
├── path-guard.ts      # Glob matching, read/write/edit checking
├── bash-guard.ts      # Bash command parsing, command extraction, file op detection
└── types.ts           # Shared types
```

## Implementation Tasks
- [x] Create types.ts — config types, result types
- [x] Create config.ts — load, merge, validate
- [x] Create path-guard.ts — glob matching, read/write checks
- [x] Create bash-guard.ts — bash command parser, deny check, file op detection
- [x] Create index.ts — wire everything together with tool_call events
- [x] Create default guardrails.example.json
- [x] Fix relative path resolution in glob matching
