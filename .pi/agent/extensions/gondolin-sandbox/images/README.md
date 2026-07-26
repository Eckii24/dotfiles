# pi-agent-base:0.12.0

Build only on a trusted host:

```bash
docker build -t pi-agent-base:0.12.0 .
```

Contains Alpine plus Git, OpenSSH, Node/npm, ripgrep, findutils, jq, zsh, bash, coreutils and **RTK 0.43.0**. The RTK musl release is downloaded from the versioned GitHub asset and SHA-256-verified during image assembly. Do not copy or commit image binaries. The extension defaults to this exact tag and fails closed if Gondolin or RTK cannot start it.
