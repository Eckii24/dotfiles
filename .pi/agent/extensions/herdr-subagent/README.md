# Herdr Subagent

Visible, interactive Pi child panes for Herdr. This extension exposes `subagent` and `subagent_control` for owned panes.

```
calling Pi (Herdr pane)
  └─ subagent ── protocol-16 Unix socket ── Herdr tab `group · pi-herdr:<short-id>`
       └─ 1..4 owned Pi panes ── native Pi v3 JSONL ── correlated child result
```

## Prerequisites

External/manual setup required:

- Start Pi inside a live Herdr-managed pane. Outside Herdr, launch fails strictly with `not_in_herdr`; no topology is created.
- Install and enable Herdr's Pi integration manually, then restart Pi. Caller must have `HERDR_ENV=1`, a current-user direct Unix `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` in a live workspace.
- Make `pi` executable on `PATH`, or set absolute executable `PI_HERDR_PI_EXECUTABLE`.
- Create agent profiles in user `agents/` and/or nearest project `.pi/agents/`. Profile frontmatter requires `name` and `description`; optional `tools` and `model` are validated. Project profiles override same-named user profiles and require UI confirmation by default.

Verified baseline: Pi `0.80.6`; Herdr `0.7.3`; Herdr protocol `16`; result protocol version `1`. Protocol negotiation also requires snapshot, tabs, agents, panes, layout, events, and fixed-interrupt capability.

## Launch schema

`subagent` accepts a strict object: extra fields fail.

```ts
type Item = { name?: string; agent: string; task: string; cwd?: string };
type Launch = {
  group: string;                         // sanitized, 1..60 Unicode scalars
  agent?: string; task?: string; cwd?: string; // single mode
  tasks?: Item[];                        // parallel, 1..4
  chain?: Item[];                        // sequential, 1..4
  agentScope?: "user" | "project" | "both"; // default "user"
  confirmProjectAgents?: boolean;        // default true
  timeoutSeconds?: number;               // integer 1..86400; default 1800
  keepOpen?: boolean;                    // default false
  allowSharedWorkspaceWrites?: boolean;  // default false
};
```

Provide exactly one mode: `agent` + `task` (single), `tasks`, or `chain`. `cwd` must resolve to an existing canonical directory. Tasks must be non-empty and CR/LF-free. Each child receives the readable task text followed once by an opaque per-turn terminal sentinel; chain replaces `{previous}` with previous final output before this delivery.

```json
{
  "group": "research",
  "tasks": [
    {"name":"api","agent":"scout","task":"Map API boundaries."},
    {"name":"tests","agent":"scout","task":"Map test entrypoints."}
  ],
  "timeoutSeconds": 300
}
```

Result details use protocol version `1`: root/tab/workspace IDs, group/mode/status, `keepOpen`, timestamps, ordered `children`, and warnings. Each child reports its leaf/pane IDs, profile, canonical cwd, status; successful native harvest may add `piSession`, `finalOutput`, `stopReason`, and usage. Root statuses: `succeeded`, `blocked`, `failed`, `aborted`, `timed_out`.

## Topology and capacity

One run owns one newly created tab. Label is `<group> · pi-herdr:<short root id>`; panes use `<profile name> · <short leaf id>`. IDs, not labels or screen position, establish ownership.

- Maximum **3 managed tabs per workspace** and **4 panes per group**.
- Parallel starts all children; chain starts next child only after previous success. Blocked work stops later queued chain work.
- Existing snapshot labels conservatively consume tab capacity. Coordination state and locks live in current-user mode-`0700` `${XDG_RUNTIME_DIR:-/tmp}/pi-herdr-subagent-<uid>`.

## Native result path

Result evidence comes only from the child session reference `source: "herdr:pi", kind: "path"`. The path is checked as a current-user, non-symlink regular file below the configured Pi session root, bounded to 4 MiB and 256 KiB/line, then parsed as Pi session JSONL v3. A native user entry anchors only when it contains its opaque per-turn sentinel exactly once as the terminal suffix; its descendant final assistant entry supplies result evidence. A Herdr `idle` or `done` state alone is never a result.

No `completion.json` or other completion sidecar exists. It would duplicate and weaken Pi's persisted, correlated session record. This extension does not scrape pane screen output or terminal transcripts.

## Retention, blocked work, and control

Default `keepOpen: false`: non-blocked completion cleans owned panes, tab (only when no foreign pane exists), write leases, and capacity reservation. Set `keepOpen: true` to retain a successful leaf for a later native Pi turn.

`subagent_control` strict schema:

```ts
type Control = {
  action: "status" | "steer" | "follow_up" | "collect" | "abort" | "close";
  rootRunId: string;
  leafRunId?: string;
  message?: string;
  timeoutSeconds?: number;       // integer 1..86400
  closeAfterCollect?: boolean;
};
```

Rules: `status` and `close` allow only IDs; `steer`/`follow_up` require newline-free `message`; `collect` optionally accepts timeout and `closeAfterCollect`; `abort` optionally accepts timeout. A multi-leaf eligible action needs `leafRunId` (`ambiguous_turn` otherwise). IDs resolve only through the local owned-run registry.

Examples:

```json
{"action":"status","rootRunId":"<root>"}
{"action":"follow_up","rootRunId":"<root>","leafRunId":"<leaf>","message":"Summarize findings."}
{"action":"collect","rootRunId":"<root>","leafRunId":"<leaf>","closeAfterCollect":true}
{"action":"close","rootRunId":"<root>"}
```

`follow_up` requires `keepOpen: true`, a succeeded leaf, foreground Pi, and unchanged trusted Pi session identity. It waits for another correlated native final.

For `blocked`: resolve the prompt/question manually in the visible owned Pi pane; then call `collect` on that leaf. If state remains `blocked`, collection returns that state without claiming a final. `steer` is limited to owned working/blocked leaves and sends literal text plus fixed Enter; it is not a fully live-validated blocked-resolution path. Blocked groups are retained rather than default-cleaned.

`abort` sends only fixed Ctrl-C as a G2-limited candidate, waits at most one second (or less requested), then closes owned resources. Response reports `abortCandidateSent: true` and `gracefulAbortProven: false`: do not treat it as graceful Pi abort.

## Nested orchestration and writes

Use an `orchestrator` profile to call this tool from a child Pi pane. Child launch carries root/leaf/group/depth metadata. Nested result includes `parentRootRunId`; maximum child nesting depth is 3. Nested coordinators share the same capacity runtime directory.

Profiles declaring `edit` or `write` are writers. A current-user atomic write lease is per canonical cwd; concurrent writers to same cwd fail unless `allowSharedWorkspaceWrites: true`, which emits a conflict warning. No worktrees are created, selected, or supported. Use distinct existing directories for concurrent writers.

## Cleanup

- Setup/start failure: roll back owned panes/bootstrap pane, leases, reservation, and temporary launch files best-effort.
- Non-blocked default completion: close owned panes; close tab only after snapshot confirms no foreign pane; release leases/reservation. Warnings report incomplete cleanup.
- Retained or blocked work: remains until `close`, or `collect` with `closeAfterCollect: true` after result becomes available.
- Detach/lost pane: registry no longer grants unsafe authority; use `status`, then close only if still owned. Foreign panes always leave tab open.

## Recovery table

| Code | Exact operator action |
|---|---|
| `not_in_herdr` | Restart Pi from a Herdr-managed pane. |
| `missing_herdr_socket` | Restart Herdr and Pi as same user; do not point at symlink/non-socket path. |
| `herdr_socket_unreachable` | Restart Herdr and Pi. |
| `herdr_protocol_unsupported` | Update Herdr to protocol 16 with required capabilities. |
| `calling_pane_not_found` | Restart Pi in a live Herdr workspace pane. |
| `pi_integration_missing` | Install/enable Herdr Pi integration manually; configure executable Pi; restart Pi. |
| `agent_profile_not_found` / `agent_profile_invalid` | Add/fix selected profile in requested scope; retry. |
| `project_agent_not_confirmed` | Approve project profile in UI, or choose user scope/profile. |
| `invalid_execution_mode` / `invalid_group` | Correct strict input, mode, task/message, timeout, group, or cwd; retry. |
| `tab_capacity_exceeded` / `pane_capacity_exceeded` | Close owned retained groups or reduce request to limits; retry. |
| `nesting_depth_exceeded` | Return to shallower caller; limit is depth 3. |
| `shared_workspace_write_conflict` | Use distinct canonical cwd values; override only with deliberate conflict risk. |
| `tab_create_failed` / `agent_start_failed` | Check Herdr/Pi availability and profile; retry after cleanup. |
| `child_boot_timeout` / `turn_timeout` | Inspect visible child pane; resolve or close; retry with valid larger timeout if needed. |
| `task_delivery_failed` / `task_anchor_missing` | Do not resend blindly; inspect/close child, then start new run. |
| `child_blocked` | Resolve manually in owned pane, then `collect`; otherwise `close`. |
| `pane_lost` | Pane ownership is gone; do not steer; start a new run. |
| `session_reference_missing` / `session_path_untrusted` / `session_parse_failed` | Do not trust output; close owned pane and start a new run. |
| `ambiguous_turn` | Supply eligible `leafRunId`; do not guess a target. |
| `empty_final_output` / `result_unavailable` | Keep/inspect child and `collect` when native JSONL flushes; otherwise close and rerun. |
| `child_model_error` / `child_aborted` | Inspect child result; retry as a new run if appropriate. |
| `cleanup_incomplete` | Read warnings; manually remove only proven-owned panes/tab, then retry. |
| `unknown_or_foreign_run` | Do not operate it; only locally registered, ownership-proven runs are controllable. |

## Security boundary

Public tools expose no raw Herdr method, raw key sequence, shell/Bash control, arbitrary pane/tab IDs, socket path, auth material, or transcript scraping. Internal controls target owned panes only and use fixed Enter/Ctrl-C candidates. Socket, runtime directory, session path, and cleanup ownership checks fail closed where identity is not proven.
