#!/bin/bash

set -eu

echo "Install Neovim plugins"
nvim --headless "+Lazy! sync" +qa
