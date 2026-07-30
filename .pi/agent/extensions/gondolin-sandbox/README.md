# Gondolin sandbox

Dormant unless `--sandbox` or exact `PI_SANDBOX=gondolin`. Active TUI/print/json routes built-in file and shell surfaces into one Gondolin VM per Pi process. Every sandboxed bash and `user_bash` command is rewritten guest-side by the verified RTK 0.43.0 binary before execution; host `rtk-rewrite` deliberately skips sandboxed calls. Host guardrails deliberately skip all sandboxed calls: the guest workspace is intentionally unrestricted within its mounts. RPC activation fails closed. Default host exposure: current workspace RW at `/workspace`; network deny by default; no credential mounts.

Commands: `/sandbox-status`, `/sandbox-policy`, `/sandbox-mount-ro`, `/sandbox-mount-rw`, `/sandbox-network-allow`, `/sandbox-network-deny`. Policy writes only occur through interactive idle TUI commands; project policy requires Pi trust and full-section approval.

Default image: `pi-agent-base:0.12.0`. On first sandbox startup, extension builds host-native bundled image, imports it into Gondolin local image store, then starts it. First build needs Docker and network access for Alpine packages plus verified RTK release. Custom policy images are never built by extension. Build/status failures show exact reason in footer and `/sandbox-status`.
