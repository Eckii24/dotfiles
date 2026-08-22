#!/bin/sh
set -eu

mkdir -p /dev
rm -f /dev/null /dev/random /dev/urandom
mknod -m 666 /dev/null c 1 3
mknod -m 444 /dev/random c 1 8
mknod -m 444 /dev/urandom c 1 9

arch="$(uname -m)"
case "$arch" in
  x86_64) uv_asset="uv-x86_64-unknown-linux-musl.tar.gz"; yq_asset="yq_linux_amd64" ;;
  aarch64|arm64) uv_asset="uv-aarch64-unknown-linux-musl.tar.gz"; yq_asset="yq_linux_arm64" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

npm config set strict-ssl false
npm install --global bun
bun --version

# Cargo cannot spawn rustc reliably while Gondolin builds inside its Docker/chroot
# boundary. Install the pinned upstream binary instead; gcompat makes its GNU
# build usable on Alpine.
case "$arch" in
  x86_64)
    ast_grep_asset="app-x86_64-unknown-linux-gnu.zip"
    ast_grep_sha256="76fb6555be6734fb5057dba8d2fb756430f374bb9e1af694cf1ce00e13238d63"
    ;;
  aarch64|arm64)
    ast_grep_asset="app-aarch64-unknown-linux-gnu.zip"
    ast_grep_sha256="9ee7ec49aada3dc05135d21977af089a33fc3154ada25bab102daca90b5098f2"
    ;;
esac
curl -kfsSL --retry 3 --retry-all-errors -o /tmp/ast-grep.zip "https://github.com/ast-grep/ast-grep/releases/download/0.45.1/${ast_grep_asset}"
printf '%s  %s\n' "$ast_grep_sha256" /tmp/ast-grep.zip | sha256sum -c -
unzip -q /tmp/ast-grep.zip -d /tmp/ast-grep
install -m 0755 /tmp/ast-grep/ast-grep /usr/local/bin/ast-grep
rm -rf /tmp/ast-grep.zip /tmp/ast-grep
ast-grep --version

pip config set global.trusted-host pypi.org
pip config set global.trusted-host files.pythonhosted.org
pip install --break-system-packages --no-cache-dir pre-commit
pre-commit --version

curl -kfsSL --retry 3 --retry-all-errors -o /tmp/uv.tar.gz "https://github.com/astral-sh/uv/releases/download/0.12.3/${uv_asset}"
tar -xzf /tmp/uv.tar.gz -C /tmp
install -m 0755 "/tmp/${uv_asset%.tar.gz}/uv" /usr/local/bin/uv
uv --version
rm -rf /tmp/uv.tar.gz "/tmp/${uv_asset%.tar.gz}"

curl -kfsSL --retry 3 --retry-all-errors -o /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/latest/download/${yq_asset}"
chmod 0755 /usr/local/bin/yq
yq --version

case "$arch" in
  x86_64)
    curl -kfsSL --retry 3 --retry-all-errors -o /tmp/rtk.tar.gz https://github.com/rtk-ai/rtk/releases/download/v0.43.0/rtk-x86_64-unknown-linux-musl.tar.gz
    echo 'ff8a1e7766496e175291a85aeca1dc97c9ff6df33e51e5893d1fbc78fea2a609  /tmp/rtk.tar.gz' | sha256sum -c -
    tar -xzf /tmp/rtk.tar.gz -C /usr/local/bin rtk
    chmod 0755 /usr/local/bin/rtk
    rm -f /tmp/rtk.tar.gz
    ;;
  aarch64|arm64)
    git clone --depth 1 --branch v0.43.0 https://github.com/rtk-ai/rtk.git /tmp/rtk-src
    cd /tmp/rtk-src
    CARGO_HTTP_CHECK_REVOKE=false CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --release --locked
    install -m 0755 target/release/rtk /usr/local/bin/rtk
    rm -rf /tmp/rtk-src
    ;;
  *) echo "unsupported arch for rtk: $arch" >&2; exit 1 ;;
esac
/usr/local/bin/rtk --version
