#!/bin/bash

set -eu

# Install dependencies using Brewfile
if [[ -f "$HOME/.config/yadm/Brewfile" ]]; then
  echo "Installing dependencies from Brewfile..."
  brew bundle --file="$HOME/.config/yadm/Brewfile"
else
  echo "No Brewfile found. Skipping dependency installation."
fi
