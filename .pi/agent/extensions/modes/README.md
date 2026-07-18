# Modes Extension

A mode is a direct Markdown file in `~/.pi/agent/modes/`. The extension exposes `command` as a slash command, applies declared session settings, persists the selected identity, and appends the Markdown body only when Pi later starts an agent loop.

Running `/quick`, `/work`, or `/orchestrate` changes settings only. It does not submit a prompt or make an LLM call.

## Dependency

This extension parses frontmatter with `yaml` (pinned in `package.json`/`bun.lock`). After a fresh checkout, run `bun install` in this directory.

## Mode format

```md
---
command: quick
description: Direct small work
model: "@small"
tools: [read, grep, find, ls, edit, write, bash]
skills: [implementation-workflow]
thinking: low
---

Mode-specific system rules.
```

Required frontmatter:

| Field | Meaning |
|---|---|
| `command` | Lowercase slash-command name (`quick`, invoked as `/quick`) |

Optional frontmatter:

| Field | Meaning |
|---|---|
| `description` | Command-list description |
| `model` | Exact `provider/model`, bare model ID resolved through `defaultProvider`, or quoted `@identifier` resolved through `modelTiers`. Omit to retain the session model. |
| `tools` | YAML array of active tools, e.g. `tools: [read, grep]` or block form. Omit to retain active tools. `[]` is invalid. Unknown names block activation. |
| `skills` | YAML array of Pi-discovered skill names, e.g. `skills: ["a", "b"]` or block form. Omit to keep Pi's normal skill index. Use `[]` to hide all skills. A declared list changes only the visible metadata index; Pi still loads a full `SKILL.md` normally only when the model reads it or the user invokes `/skill:<name>`. Missing/ambiguous names fail closed. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Omit to retain the session level. |

`@` is YAML-reserved at the start of a plain scalar. Quote tier aliases: `model: "@medium"`. Mode frontmatter is parsed as YAML: scalar fields must be strings; list fields (`tools`, `skills`) must be YAML arrays of strings. Comma-separated list strings are rejected.

The Markdown body is the active mode prompt. Use `/modes` to inspect installed modes and the active mode.

## Security and execution model

Mode activation validates requested model and tools before changing session state. `orchestrate` deliberately has only `subagent`, `subagent_control`, `read`, `grep`, `find`, and `ls`; it cannot directly mutate files or execute shell commands. Its prompt imposes a phase/delegation budget; this is workflow policy, not a security control. Guardrails remain separate and are never disabled by a mode.
