#!/bin/bash

set -eu

install_brew_dependencies_on_linux(){
  if [[ uname == "Linux" ]]; then
    echo "Install dependencies for Homebrew..."

    if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
      sudo apt-get update && sudo apt-get install -y build-essential procps curl file git
    else
      apt-get update && apt-get install -y build-essential procps curl file git
    fi
  fi
}

# Install Homebrew if not already installed
if ! command -v brew &>/dev/null; then
  install_brew_dependencies_on_linux

  echo "Homebrew not found. Installing Homebrew..."
  export NONINTERACTIVE=1
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Homebrew is already installed."
fi
