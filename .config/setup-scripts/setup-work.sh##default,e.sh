#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/lib/setup-common.sh"

if [ -f "$COMMON_SH" ]; then
  # shellcheck source=./lib/setup-common.sh
  . "$COMMON_SH"
else
  . <(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/lib/setup-common.sh)
fi

echo "Starting setup for work environment..."

ensure_brew_in_path

echo "Set YADM class work"
yadm config --add local.class work

echo "Install azure-cli"
brew install azure-cli
az extension add --name azure-devops

echo "Add user to docker group"
run_root groupadd docker || true
run_root usermod -aG docker "$USER"

echo "Installing dapr"
brew install dapr/tap/dapr-cli

echo "Init SQL server in docker and sqlcmd"
run_root docker run -e 'ACCEPT_EULA=Y' -e 'MSSQL_SA_PASSWORD=Test_1234' -p 1433:1433 --name mssql_server -d mcr.microsoft.com/mssql/server:2022-latest
brew install sqlcmd

echo "Install redis-cli"
brew tap ringohub/redis-cli
brew install redis-cli

echo "Install mockoon-cli"
run_root bun install -g @mockoon/cli

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
