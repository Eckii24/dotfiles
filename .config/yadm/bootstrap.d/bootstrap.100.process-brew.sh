#!/bin/bash

set -eu

source $HOME/.config/yadm/bootstrap.d/bootstrap_functions##class.never,e.sh

# Install Homebrew if not already installed
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Installing Homebrew..."
  export NONINTERACTIVE=1
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  add_brew_to_path 
else
  echo "Homebrew is already installed."
fi

# Install dependencies using Brewfile
if [[ -f "$HOME/.config/yadm/Brewfile" ]]; then
  echo "Installing dependencies from Brewfile..."
  brew bundle --file="$HOME/.config/yadm/Brewfile"
else
  echo "No Brewfile found. Skipping dependency installation."
fi
