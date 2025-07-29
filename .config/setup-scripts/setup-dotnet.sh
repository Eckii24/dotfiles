#!/bin/bash

echo "Starting setup for dotnet..."

echo "Set YADM class dotnet"
yadm config --add local.class dotnet

echo "Install dependencies for dotnet..."
if [[ "$(uname)" == "Linux" ]]; then
  # Add Microsoft package repository for .NET
  curl -sSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/packages-microsoft-prod.deb

  if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    sudo dpkg -i /tmp/packages-microsoft-prod.deb
    sudo apt-get update && sudo apt-get install -y dotnet-sdk-8.0 dotnet-sdk-9.0
  else
    dpkg -i /tmp/packages-microsoft-prod.deb
    apt-get update && apt-get install -y dotnet-sdk-8.0 dotnet-sdk-9.0
  fi

  rm /tmp/packages-microsoft-prod.deb
elif [[ "$(uname)" == "Darwin" ]]; then
  # Function to add Homebrew to PATH on macOS
  if ! command -v brew &>/dev/null; then
    echo "Homebrew not found. Adding to PATH..."
    if [[ -x "/opt/homebrew/bin/brew" ]]; then
      # Apple Silicon (ARM)
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x "/usr/local/bin/brew" ]]; then
      # Intel Mac
      eval "$(/usr/local/bin/brew shellenv)"
    else
      echo "Homebrew not found. Exiting..."
      exit 1
    fi
  fi
  brew install --cask dotnet-sdk
fi

echo "Install dotnet tools..."
dotnet tool install -g csharpier
dotnet tool install -g dotnet-outdated-tool
dotnet tool install -g dotnet-ef
dotnet tool install -g JetBrains.ReSharper.GlobalTools

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa
