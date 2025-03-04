#!/bin/bash

set -eu

echo "Install Neovim Nightly"
bob use nightly

echo "Sync Neovim plugins"
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa
