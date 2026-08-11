# Versioned Gondolin base image. Build locally; do not commit image artifacts.
FROM alpine:3.21
RUN apk --no-check-certificate add --no-cache bash coreutils curl findutils git jq nodejs npm openssh python3 py3-pip ripgrep tar unzip zsh \
 && npm config set strict-ssl false \
 && npm install --global bun \
 && curl -kfsSL --retry 3 --retry-all-errors -o /tmp/ast-grep.zip https://github.com/ast-grep/ast-grep/releases/download/0.45.1/app-x86_64-unknown-linux-gnu.zip \
 && unzip -j /tmp/ast-grep.zip ast-grep -d /usr/local/bin \
 && chmod 0755 /usr/local/bin/ast-grep \
 && rm -f /tmp/ast-grep.zip \
 && pip config set global.trusted-host pypi.org \
 && pip config set global.trusted-host files.pythonhosted.org \
 && pip install --break-system-packages --no-cache-dir pre-commit \
 && curl -kfsSL --retry 3 --retry-all-errors -o /tmp/uv.tar.gz https://github.com/astral-sh/uv/releases/download/0.12.3/uv-x86_64-unknown-linux-musl.tar.gz \
 && tar -xzf /tmp/uv.tar.gz -C /tmp \
 && install -m 0755 /tmp/uv-x86_64-unknown-linux-musl/uv /usr/local/bin/uv \
 && rm -rf /tmp/uv.tar.gz /tmp/uv-x86_64-unknown-linux-musl \
 && curl -kfsSL --retry 3 --retry-all-errors -o /usr/local/bin/yq https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64 \
 && chmod 0755 /usr/local/bin/yq \
 && curl -kfsSL --retry 3 --retry-all-errors -o /tmp/rtk.tar.gz https://github.com/rtk-ai/rtk/releases/download/v0.43.0/rtk-x86_64-unknown-linux-musl.tar.gz \
 && echo "ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609  /tmp/rtk.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk \
 && chmod 0755 /usr/local/bin/rtk \
 && rtk --version \
 && rm -f /tmp/rtk.tar.gz
