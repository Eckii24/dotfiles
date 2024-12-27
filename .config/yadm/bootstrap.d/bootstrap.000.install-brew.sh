#!/bin/bash

set -eu

# Function to add Homebrew to PATH
add_brew_to_path() {
  if [[  -x "/opt/homebrew/bin/brew"  ]]; then
    # Apple Silicon (ARM)
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[  -x "/usr/local/bin/brew"  ]]; then
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  elif [[  -x "/home/linuxbrew/.linuxbrew/bin/brew"  ]]; then
    # Linux
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  fi
}

# Install Homebrew if not already installed
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Installing Homebrew..."
  export NONINTERACTIVE=1
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  add_brew_to_path 
else
  echo "Homebrew is already installed."
fi
