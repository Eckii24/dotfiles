#!/bin/bash

echo "Starting setup for work environment..."

# Function to add Homebrew to PATH
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Adding to PATH..."
  if [[  -x "/opt/homebrew/bin/brew"  ]]; then
    # Apple Silicon (ARM)
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[  -x "/usr/local/bin/brew"  ]]; then
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  elif [[  -x "/home/linuxbrew/.linuxbrew/bin/brew"  ]]; then
    # Linux
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  else
    echo "Homebrew not found. Exiting..."
    exit 1
  fi
else
  echo "Homebrew already added to PATH."
fi

echo "Set YADM class work"
yadm config --add local.class work

echo "Install azure-cli"
brew install azure-cli

echo "Installing dapr"
if ! command -v dapr &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/dapr/cli/master/install/install.sh)"

  # Initialize dapr
  if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    sudo dapr init
  else
    dapr init
  fi
else
  echo "dapr is already installed."
fi

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
