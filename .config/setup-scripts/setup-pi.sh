#!/bin/bash

echo "Starting setup for pi agent..."

# Function to add Homebrew to PATH
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Adding to PATH..."
  if [[ -x "/opt/homebrew/bin/brew" ]]; then
    # Apple Silicon (ARM)
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x "/usr/local/bin/brew" ]]; then
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  elif [[ -x "/home/linuxbrew/.linuxbrew/bin/brew" ]]; then
    # Linux
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  else
    echo "Homebrew not found. Exiting..."
    exit 1
  fi
else
  echo "Homebrew already added to PATH."
fi

echo "Install pi-coding-agent..."
bun install -g @mariozechner/pi-coding-agent
