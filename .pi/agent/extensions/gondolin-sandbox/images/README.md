# Gondolin guest images

Default sandbox image: `pi-agent-work:0.12.1`

## Build on working machine

Build base + work images with Gondolin, then tag them in local Gondolin image store:

```sh
gondolin build --config images/pi-agent-base.build.json --tag pi-agent-base:0.12.1
gondolin build --config images/pi-agent-work.build.json --tag pi-agent-work:0.12.1
```

Check refs:

```sh
gondolin image ls
```

## If SSL/TLS breaks on broken machine

Do not use Docker. Transfer Gondolin image store.

### 1) On working machine, export Gondolin image store

```sh
store="${GONDOLIN_IMAGE_STORE:-$HOME/.cache/gondolin/images}"
tar -C "$(dirname "$store")" -czf gondolin-images.tgz "$(basename "$store")"
```

### 2) Copy `gondolin-images.tgz` to broken machine

### 3) On broken machine, restore image store

```sh
store="${GONDOLIN_IMAGE_STORE:-$HOME/.cache/gondolin/images}"
mkdir -p "$(dirname "$store")"
tar -C "$(dirname "$store")" -xzf gondolin-images.tgz
```

### 4) Verify refs

```sh
gondolin image ls
```

### 5) Retry Pi

Sandbox should now resolve the tagged Gondolin image from local store and skip rebuild.

## Notes

- `pi-agent-work:0.12.1` is default sandbox image in extension.
- `pi-agent-base:0.12.1` stays available if you want leaner image; set `GONDOLIN_DEFAULT_IMAGE=pi-agent-base:0.12.1` to use it.
- Build still needs network on the working machine that creates the Gondolin store.
