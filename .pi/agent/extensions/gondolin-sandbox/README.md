# Gondolin sandbox

Pi execution inside one Gondolin micro-VM per Pi process. The sandbox is dormant by default. Activate it only with `--sandbox`; sandboxed child Pi processes receive the exact `PI_SANDBOX=gondolin` marker from their running parent.

## Model

Mounts, guest environment, and network rules are fixed at startup. They can come from the global/project `sandbox` settings or session-only CLI parameters; they are not TUI mutations.

| Surface | Default |
| --- | --- |
| Workspace | Current directory read/write at `/workspace` |
| Extra host paths | Not exposed |
| Network | Denied |
| Credentials | Not mounted or copied to the guest |
| Routed Pi tools | `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, `user_bash` run in the guest |
| RPC mode | Rejected fail-closed because RPC bash bypasses extension routing |

The guest is unrestricted *inside its mounts*. A read/write mount gives the guest authority to change those host files. Mount the smallest path that solves the task.

## Start Pi

```bash
cd /path/to/project
pi --sandbox
```

This makes the canonical current working directory available read/write as `/workspace`. On first use of the bundled default image, the extension builds a host-native image and imports it into Gondolin's local image store. That initial build may require network access on a trusted machine.

## Configure persistent startup policy

Global `~/.pi/agent/settings.json` and trusted project `.pi/settings.json` may contain a `sandbox` block. Project values merge over global values; mount lists combine. CLI parameters add a session overlay.

```json
{
  "sandbox": {
    "mounts": {
      "readOnly": [
        {
          "hostPath": "/absolute/path/reference-docs",
          "guestPath": "/reference",
          "required": true
        }
      ],
      "readWrite": [
        {
          "hostPath": "/absolute/path/generated",
          "guestPath": "/generated",
          "required": true
        }
      ]
    },
    "environment": {
      "REFERENCE_PATH": "/reference",
      "GENERATED_PATH": "/generated"
    }
  }
}
```

| Settings key | Guest behavior | Typical use |
| --- | --- | --- |
| `sandbox.mounts.readOnly` | Writes fail | Sources, docs, SDKs, fixtures |
| `sandbox.mounts.readWrite` | Writes change host files directly | Explicit output, build, or cache paths |
| `sandbox.environment` | Sets guest-only environment variables | Stable names for mounted guest paths |

Read/write mounts grant the sandbox authority to modify the corresponding host path. Prefer narrow directories. Mount entries use the same strict object format and validation rules as CLI mounts below.

The policy is applied only when the sandbox is activated with `--sandbox` (or inherited by a sandboxed child).

## Add mounts at startup

CLI mount and network parameters are session-only. They affect this Pi process and its sandboxed child Pi processes, but do not write `settings.json` or any project file.

### One read-only mount

```bash
pi --sandbox --sandbox-mount-ro /absolute/path/reference-docs
```

Without a guest path, the canonical host path is also the guest path.

### One read/write mount with an explicit guest path

```bash
pi --sandbox \
  --sandbox-mount-rw '{"hostPath":"/absolute/path/generated","guestPath":"/generated","required":true}'
```

Use an explicit guest path for a stable, short guest interface such as `/generated`.

### Multiple mounts

Pi extension flags accept one scalar value. For multiple entries, supply one JSON array:

```bash
pi --sandbox \
  --sandbox-mount-ro '[
    "/absolute/path/specs",
    {"hostPath":"/absolute/path/sdk","guestPath":"/deps/sdk","required":true}
  ]' \
  --sandbox-mount-rw '[
    {"hostPath":"/absolute/path/generated","guestPath":"/generated"}
  ]'
```

An entry is either an absolute host-path string:

```json
"/absolute/host/path"
```

or a strict object:

```json
{
  "hostPath": "/absolute/host/path",
  "guestPath": "/absolute/guest/path",
  "required": true
}
```

| Flag | Guest behavior | Typical use |
| --- | --- | --- |
| `--sandbox-mount-ro` | Writes fail | Sources, docs, SDKs, fixtures |
| `--sandbox-mount-rw` | Writes change host files | Explicit output/build/cache paths |

`required: true` makes a missing host path a startup error. Startup mounts must exist and resolve successfully either way. Host and guest paths must be absolute and normalized. Pi does not expand `~`, `$HOME`, or shell variables in extension-flag values. `/workspace` is reserved and cannot be an extra guest mount.

Do not use a broad read/write mount merely because a tool may write temporary files. Prefer a narrow output directory or the existing workspace.

## Add network rules at startup

Network is deny-by-default. Allow exact hostnames or `*.` subdomain patterns only:

```bash
pi --sandbox \
  --sandbox-network-allow '["api.example.com","*.packages.example.org"]' \
  --sandbox-network-deny blocked.packages.example.org
```

Deny takes precedence over allow, including where an exact rule overlaps a wildcard.

## A running Pi cannot gain mounts

There are no `/sandbox mount …` or `/sandbox network …` commands. A Gondolin VM has a fixed virtual filesystem and network policy from startup. To change access, end the session and launch a new one with the required parameters:

```bash
# Current session: no /reference mount
exit

# New session: /reference is visible read-only
pi --sandbox --sandbox-mount-ro /absolute/path/reference-docs
```

This is intentional: a command that reported success but applied only after restart was misleading and created hidden, persistent authority.

## Status command

The only chat command is read-only status:

```text
/sandbox
# equivalent:
/sandbox status
```

It reports activation state, failure reason when present, resolved backend, image, guest workspace, actual mount map, and effective network rules. Any other arguments are rejected with:

```text
usage: /sandbox [status]
```

## Internals

1. The extension installs wrappers for Pi's built-in execution tools before Pi applies CLI flag values. Until `session_start` latches activation, normal host tools are used.
2. `--sandbox` is mandatory if any `--sandbox-mount-*` or `--sandbox-network-*` parameter is supplied. Otherwise startup fails before VM creation.
3. CLI values are strictly parsed, canonicalized, and validated before the VM exists. Unknown JSON keys, relative paths, nonexistent mount paths, malformed network hosts, guest-path collisions, and oversized inherited overlays fail closed.
4. The VM starts with the final mount map. Host paths are translated to the longest matching guest mount. Unmapped paths are rejected; no tool can accidentally reach the host.
5. Routed `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, and `user_bash` execute guest-side. Guest search and shell output is bounded before it crosses the VM boundary.
6. Guest `bash` and `user_bash` commands are rewritten by the verified guest RTK binary. The host `rtk-rewrite` hook deliberately skips sandboxed calls.
7. A successfully started parent propagates only the exact sandbox marker plus a bounded, revalidated session overlay to child Pi processes. Each child starts its own VM.
8. On shutdown, the VM is closed. Print/JSON mode initiates cleanup without awaiting it in Pi's shutdown hook to avoid lifecycle deadlock.

## Failure behavior

- If VM startup, tool ownership, image setup, or a guest route fails, Pi returns `SANDBOX FAILED: …`. It does not fall back to a host tool.
- `PI_SANDBOX=gondolin` is an internal child-process marker. It does not authorize arbitrary new flags; a parent must have explicitly started with `--sandbox`.
- `--mode rpc` is unsupported with the sandbox and fails closed.
- If the bundled image cannot be built because of TLS or network problems, build/import it on a trusted machine or transfer the Gondolin local image store. Do not weaken the sandbox to work around image setup.
