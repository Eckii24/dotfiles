#!/bin/sh
set -eu

sh /tmp/base-postbuild.sh

arch="$(uname -m)"
case "$arch" in
  x86_64) dapr_asset="dapr_linux_amd64.tar.gz"; k6_asset="k6-v2.2.0-linux-amd64.tar.gz" ;;
  aarch64|arm64) dapr_asset="dapr_linux_arm64.tar.gz"; k6_asset="k6-v2.2.0-linux-arm64.tar.gz" ;;
  *) echo "unsupported arch: $arch" >&2; exit 1 ;;
esac

mkdir -p /etc/profile.d
cat > /etc/profile.d/dotnet-tools.sh <<'EOF'
export PATH="/usr/lib/dotnet:/root/.dotnet/tools:$PATH"
EOF
chmod 0755 /etc/profile.d/dotnet-tools.sh

curl -kfsSL --retry 3 --retry-all-errors -o /tmp/dotnet-install.sh https://dot.net/v1/dotnet-install.sh
bash /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/lib/dotnet --no-path
ln -sfn /usr/lib/dotnet/dotnet /usr/local/bin/dotnet
rm -f /tmp/dotnet-install.sh

DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet tool install --global csharpier
DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet tool install --global dotnet-outdated-tool
DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet tool install --global dotnet-ef

curl -kfsSL --retry 3 --retry-all-errors -o /tmp/dapr.tar.gz "https://github.com/dapr/cli/releases/download/v1.18.0/${dapr_asset}"
tar -xzf /tmp/dapr.tar.gz -C /usr/local/bin dapr
chmod 0755 /usr/local/bin/dapr
rm -f /tmp/dapr.tar.gz

curl -kfsSL --retry 3 --retry-all-errors -o /tmp/k6.tar.gz "https://github.com/grafana/k6/releases/download/v2.2.0/${k6_asset}"
tar -xzf /tmp/k6.tar.gz -C /tmp
install -m 0755 "/tmp/${k6_asset%.tar.gz}/k6" /usr/local/bin/k6
rm -rf /tmp/k6.tar.gz "/tmp/${k6_asset%.tar.gz}"
