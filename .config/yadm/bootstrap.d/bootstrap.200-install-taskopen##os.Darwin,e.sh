#!/usr/bin/env sh
set -euo pipefail

brew install nim

REPO=/tmp/taskopen

# Remove any existing checkout to ensure a clean clone
[ -d "$REPO" ] && rm -rf "$REPO"

git clone https://github.com/jschlatow/taskopen.git "$REPO"
cd "$REPO"

make PREFIX="$HOME/.local"
sudo make PREFIX="$HOME/.local" install
