# Subagent Extension

Delegate tasks to specialized subagents with isolated context windows, plus Pi-native orchestration surfaces for active runs and modal drill-down into recent history.

## Features

- **Isolated context**: Each controllable child run uses a separate `pi --mode rpc --no-session` subprocess
- **Single / parallel / chain modes**: Existing orchestration modes are preserved
- **Shared run model**: Inline output, widget, and `/subagents` all read the same normalized tree/selection snapshot
- **Active tree widget**: The area above the editor shows the spawned subagent tree only while subagents are still active
- **Tree-first `/subagents` overlay**: Inspect active and recent runs in one tree-first modal with a persistent detail pane
- **Explicit steering/abort targeting**: Only leaves with a reachable live child-transport path resolve to controls, and the UI names the exact target node before sending actions
- **Inline nested tree**: Transcript rendering stays concise while preserving nested subagent visibility
- **Usage tracking**: Expanded inline view still shows token/cost stats per child run
- **Abort support**: Parent aborts propagate to RPC child runs

## UX Surfaces

### 1. Inline transcript summary

The tool result in the transcript is now the summary surface:

- shows a compact summary in collapsed mode instead of the full execution tree
- points you to `/subagents` for live drill-down
- keeps the full tree/details available in expanded mode

Expanded inline view still shows more detail, with the richest output for single runs and completed parallel/chain runs:

- delegated task text where available
- tool call trace
- final Markdown output for completed children
- usage stats

### 2. Above-input tree widget

The area above the editor shows a real tree of spawned subagents only while work is still active.

It shows:

- the currently active root count
- the hierarchy of top-level and nested spawned subagents for active runs
- multiple concurrent runs at once
- concise live activity for running nodes
- a hint to open `/subagents`

Once all subagents finish, the widget disappears; historical inspection moves to `/subagents`.

### 3. Tree-first `/subagents` overlay

Run `/subagents` to open a Pi overlay with:

- a persistent **tree pane** on the left
- a persistent **selected-node detail pane** on the right
- both **Active** and **Recent** root runs in the same tree
- direct selection of nested/inner nodes

Keys:

- `↑/↓` move selection across the flattened tree
- `Home/End` jump to the start/end
- `Enter` inspects the selected node in a dedicated execution-detail view
- `S` steers the selected live node (only when the selected leaf has a reachable live child-transport path, direct or proxied)
- `X` aborts the selected live node (same targeting rule)
- `Esc` closes

### 4. Selected-node detail pane

The detail pane stays visible while you move through the tree and shows:

- breadcrumb/path for the selected node
- status, preview, and parent/child relationship
- root run summary/scope for run nodes
- task, timeline, and steering queue/history for leaf nodes
- whether the node is live-controllable or inspect-only

Nested nodes are selectable and inspectable even when they are not directly steerable from the parent session; when a nested live leaf is still reachable through its nearest live child transport, the parent now proxies steer/abort through that child to the nested target.

### 5. Steering compose flow

Steering does **not** embed a second Pi instance.

Instead:

1. open `/subagents`
2. select the exact live target leaf in the tree
3. press `S`
4. edit the steering message in Pi’s editor compose flow
5. submit to queue a steer message on that specific live child RPC run

The compose prefill names the exact target path so it is clear which node will receive the message.

## Tool Modes

| Mode | Parameter | Description |
|------|-----------|-------------|
| Single | `{ agent, task }` | One agent, one controllable child run |
| Parallel | `{ tasks: [...] }` | Multiple child runs concurrently (max 8, 4 concurrent) |
| Chain | `{ chain: [...] }` | Sequential child runs with `{previous}` placeholder |

## Security Model

This tool executes separate `pi` subprocesses with delegated prompts and optional tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, edit files, and so on.

Default behavior:

- only **user-level agents** from `~/.pi/agent/agents` are loaded
- set `agentScope: "both"` or `"project"` to include project-local agents
- interactive runs prompt before using project-local agents unless `confirmProjectAgents: false`

## Output Behavior

### Collapsed inline view

- concise status summary
- live queued / running / done state
- `/subagents` hint for deeper inspection

### Expanded inline view

- same execution tree
- delegated task text where available
- tool call trace
- final output rendered as Markdown for completed children
- per-child usage stats
- active parallel runs stay summary-first until children complete

### Widget + overlay

These surfaces are **session-local runtime state** for the current Pi process:

- above-editor spawned-subagent tree widget for active runs only
- `/subagents` tree-first overlay with embedded details and an execution-detail drill-down on `Enter`
- steering / abort actions for live controllable child runs whose direct or proxied child-transport path still exists

## Agent Definitions

Agents are Markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
model: claude-haiku-4-5
---

System prompt for the agent goes here.
```

Locations:

- `~/.pi/agent/agents/*.md` - user-level
- `.pi/agents/*.md` - project-level (only with `agentScope: "project"` or `"both"`)

When `agentScope: "both"` is used, project agents override user agents with the same name.

## Limitations

- Nested spawned subagents appear as selectable tree nodes; only leaves with a **reachable live child-transport path** resolve to steering/abort transports, while historical/non-live nested nodes remain inspect-only
- Runtime state is in-memory for the current session; it is not restored across `/reload` or process restart
- The detail pane shows a compact recent timeline rather than a full scrollback session viewer
- Recent completed roots are retained with the existing bounded in-memory recent-run policy; they are not persisted across sessions
- No tmux backend is included in this version
