#!/bin/bash

set -eu

echo "Install Neovim Nightly"
bob use nightly

echo "Sync Neovim plugins"
nvim --headless "+Lazy! sync" +qa
