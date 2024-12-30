#!/bin/bash

echo "Starting setup for dotnet..."

echo "Set YADM class dotnet"
yadm config --add local.class dotnet


echo "Install dependencies for dotnet..."
if [[ "$(uname)" == "Linux" ]]; then

  if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    sudo apt-get update && sudo apt-get install -y dotnet-sdk-9.0
  else
    apt-get update && apt-get install -y dotnet-sdk-9.0
  fi
else
  brew install --cask dotnet-sdk
fi
