#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/lib/setup-common.sh"

if [ -f "$COMMON_SH" ]; then
  # shellcheck source=./lib/setup-common.sh
  . "$COMMON_SH"
else
  . <(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/lib/setup-common.sh)
fi

echo "Starting setup for php..."

ensure_brew_in_path

echo "Set YADM class php"
yadm config --add local.class php

echo "Install PHP composer..."
brew install composer

echo "Install phpactor..."
curl -Lo phpactor.phar https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar
chmod a+x phpactor.phar
mv phpactor.phar $(brew --prefix)/bin/phpactor

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa
