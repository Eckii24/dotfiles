# Versioned Gondolin base image. Build locally; do not commit image artifacts.
FROM alpine:3.21
RUN apk add --no-cache git openssh nodejs npm ripgrep findutils jq zsh bash coreutils curl tar \
 && curl -fsSL --retry 3 --retry-all-errors -o /tmp/rtk.tar.gz https://github.com/rtk-ai/rtk/releases/download/v0.43.0/rtk-x86_64-unknown-linux-musl.tar.gz \
 && echo "ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609  /tmp/rtk.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk \
 && chmod 0755 /usr/local/bin/rtk \
 && rtk --version \
 && rm -f /tmp/rtk.tar.gz
