# Modes Extension

A mode is a direct Markdown file in `~/.pi/agent/modes/`. The extension exposes its `command` as a slash command, selectively overrides Pi's model/tool allowlist/thinking level, persists the selected mode in the session, and appends the Markdown body to each following system prompt. Omitted fields inherit the active session.

## Mode format

```md
---
command: quick
description: Direct small work
model: "@small"
tools: read, grep, find, ls, edit, write, bash
skills: caveman
thinking: low
---
# Quick mode

Mode-specific system rules go here.
```

Required frontmatter:

| Field | Meaning |
|---|---|
| `command` | Lowercase slash-command name (`quick`, invoked as `/quick`) |

Optional frontmatter:

| Field | Meaning |
|---|---|
| `description` | Command-list description |
| `model` | Exact `provider/model` identifier, a bare model ID resolved through `defaultProvider`, or a quoted `@identifier` resolved through settings `modelTiers` first. Omit to retain the session's current model. `@` is YAML-reserved, so quote aliases: `model: "@medium"`. |
| `tools` | Comma-separated active-tool allowlist. Omit to retain the session's current active tools; unknown explicitly named tools block activation. |
| `skills` | Comma-separated names of already discovered Pi skills. Omit to retain all skills already active in the session; when named, their full `SKILL.md` content is injected in declared order. Missing or ambiguous names fail closed for that turn. |
| `thinking` | `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. Omit to retain the session's current level. |

The Markdown body is the mode system prompt. Use `/modes` to see available modes and the active one.

## Security and execution model

Mode activation is transactional as far as Pi's API permits: it verifies the requested model and all requested tools before changing the session. The orchestrate profile deliberately has only `subagent`, `read`, `grep`, `find`, and `ls`; it cannot mutate files or run shell commands. Guardrails remain a separate layer and are never disabled by a mode.
