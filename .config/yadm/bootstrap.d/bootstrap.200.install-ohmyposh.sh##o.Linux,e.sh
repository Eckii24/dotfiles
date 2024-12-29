#!/bin/bash

set -eu

if ! command -v oh-my-posh &>/dev/null; then
  echo "oh-my-posh is not installed. Installing now..."
  curl -s https://ohmyposh.dev/install.sh | bash -s -- -d /home/linuxbrew/.linuxbrew/bin
else
  echo "oh-my-posh is already installed. Skipping installation."
fi
