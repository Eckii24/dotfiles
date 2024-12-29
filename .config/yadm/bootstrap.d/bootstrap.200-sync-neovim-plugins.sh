#!/bin/bash

set -eu

echo "Sync Neovim plugins"
nvim --headless "+Lazy! sync" +qa
