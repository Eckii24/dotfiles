#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/lib/setup-common.sh"

if [ -f "$COMMON_SH" ]; then
  # shellcheck source=./lib/setup-common.sh
  . "$COMMON_SH"
else
  . <(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/lib/setup-common.sh)
fi

echo "Starting setup for dotnet..."

if [[ "$(uname)" == "Linux" && -f "/.dockerenv" ]]; then
  ensure_brew_in_path
fi

echo "Set YADM class dotnet"
yadm config --add local.class dotnet

echo "Install dependencies for dotnet..."
if [[ "$(uname)" == "Linux" ]]; then
  if have_brew; then
    ensure_brew_in_path
    brew install dotnet@8 dotnet@9
  else
    # Add Microsoft package repository for .NET
    curl -sSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb

    run_root dpkg -i /tmp/packages-microsoft-prod.deb
    run_root apt-get update && run_root apt-get install -y dotnet-sdk-8.0 dotnet-sdk-9.0

    rm /tmp/packages-microsoft-prod.deb
  fi
elif [[ "$(uname)" == "Darwin" ]]; then
  ensure_brew_in_path
  brew install --cask dotnet-sdk
fi

echo "Install dotnet tools..."
dotnet tool install -g csharpier
dotnet tool install -g dotnet-outdated-tool
dotnet tool install -g dotnet-ef

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa
