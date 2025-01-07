#!/bin/bash

echo "Starting setup for dotnet..."

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

echo "Set YADM class dotnet"
yadm config --add local.class dotnet


echo "Install dependencies for dotnet..."
if [[ "$(uname)" == "Linux" ]]; then

  if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    sudo apt-get update && sudo apt-get install -y dotnet-sdk-8.0
  else
    apt-get update && apt-get install -y dotnet-sdk-8.0
  fi
else
  brew install --cask dotnet-sdk
fi
