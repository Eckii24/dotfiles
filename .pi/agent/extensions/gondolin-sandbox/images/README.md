# pi-agent-base:0.12.0

`Dockerfile` builds base image. `work.Dockerfile` builds `pi-agent-work:0.12.0` from it, adding .NET 9 SDK, global tools matching local setup (`csharpier`, `dotnet-outdated-tool`, `dotnet-ef`), Azure CLI, Dapr CLI, and k6.

Build both images:

```sh
docker build --platform linux/amd64 -t pi-agent-base:0.12.0 -f images/Dockerfile .
docker build --platform linux/amd64 -t pi-agent-work:0.12.0 -f images/work.Dockerfile .
```

Build downloads use certificate verification disabled because build environment currently presents an untrusted TLS chain.

If SSL/TLS breaks on this machine, move image from trusted machine instead:

1. On machine where build works:

```sh
docker build --platform linux/amd64 -t pi-agent-base:0.12.0 -f images/Dockerfile .
docker build --platform linux/amd64 -t pi-agent-work:0.12.0 -f images/work.Dockerfile .
docker save pi-agent-base:0.12.0 pi-agent-work:0.12.0 | gzip > pi-agent-images.tgz
```

2. Copy `pi-agent-images.tgz` to broken machine.

3. On broken machine:

```sh
gunzip -c pi-agent-images.tgz | docker load
```

4. Verify:

```sh
docker image ls pi-agent-base:0.12.0 pi-agent-work:0.12.0
```

Then retry Pi sandbox startup. If sandbox still tries to rebuild, remove/override network-failing local build inputs and use already-loaded image tags.
