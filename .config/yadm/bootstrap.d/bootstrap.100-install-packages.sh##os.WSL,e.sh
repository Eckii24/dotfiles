#!/bin/bash

set -eu

echo "Installing packages for Linux using apt..."

echo "Adding further sources for apt"
curl -sL https://deb.nodesource.com/setup_22.x | sudo -E bash -

# Update package lists
echo "Updating package lists..."
sudo apt-get update

bin_dir="$HOME/.local/bin"
BIN="$bin_dir/bin"

# Function to install apt packages
install_apt_packages() {
  local packages_file="$HOME/.config/yadm/packages-linux.txt"
  if [[ -f "$packages_file" ]]; then
    echo "Installing packages from $packages_file..."

    # Read packages from file, filter out comments and empty lines
    local packages=$(grep -v '^#' "$packages_file" | grep -v '^$' | tr '\n' ' ')
    sudo apt-get install -y $packages

    echo "Create symlink for bat"
    ln -sf /usr/bin/batcat $bin_dir/bat

  else
    echo "No packages file found at $packages_file. Skipping apt package installation."
  fi
}

# Function to install packages from GitHub releases
install_github_packages() {
  echo "Installing packages with bin..."

  "$BIN" install github.com/eza-community/eza
  "$BIN" install github.com/dandavison/delta
  "$BIN" install github.com/jesseduffield/lazydocker
  "$BIN" install github.com/jesseduffield/lazygit
  "$BIN" install github.com/ajeetdsouza/zoxide
  "$BIN" install github.com/zellij-org/zellij
  "$BIN" install github.com/astral-sh/uv
  "$BIN" install github.com/MordechaiHadad/bob
  "$BIN" install github.com/sigoden/aichat
}

# Function to install Python packages
install_python_packages() {
  if ! command -v pre-commit &>/dev/null; then
    echo "Installing Python packages..."
    uv tool install pre-commit
  fi

  if ! command -v tldr &>/dev/null; then
    echo "Installing tldr..."
    uv tool install tldr
  fi
}

# Function to install Node packages
install_node_packages() {
  if ! command -v repomix &>/dev/null; then
    echo "Installing Node packages..."
    sudo -E npm install -g repomix
  fi
}

# Function to install ZSH plugins
install_zsh_plugins() {
  local zsh_plugins_dir="$HOME/.local/share/zsh-plugins"
  mkdir -p "$zsh_plugins_dir"

  # Install zsh-autosuggestions
  if [[ ! -d "$zsh_plugins_dir/zsh-autosuggestions" ]]; then
    echo "Installing zsh-autosuggestions..."
    git clone https://github.com/zsh-users/zsh-autosuggestions "$zsh_plugins_dir/zsh-autosuggestions"
  fi

  # Install zsh-syntax-highlighting
  if [[ ! -d "$zsh_plugins_dir/zsh-syntax-highlighting" ]]; then
    echo "Installing zsh-syntax-highlighting..."
    git clone https://github.com/zsh-users/zsh-syntax-highlighting "$zsh_plugins_dir/zsh-syntax-highlighting"
  fi

  # Install zsh-vi-mode
  if [[ ! -d "$zsh_plugins_dir/zsh-vi-mode" ]]; then
    echo "Installing zsh-vi-mode..."
    git clone https://github.com/jeffreytse/zsh-vi-mode "$zsh_plugins_dir/zsh-vi-mode"
  fi

  # Install zsh-you-should-use
  if [[ ! -d "$zsh_plugins_dir/zsh-you-should-use" ]]; then
    echo "Installing zsh-you-should-use..."
    git clone https://github.com/MichaelAquilina/zsh-you-should-use "$zsh_plugins_dir/zsh-you-should-use"
  fi
}

# Install packages
install_apt_packages
install_github_packages
install_python_packages
install_node_packages
install_zsh_plugins

echo "Linux package installation completed!"
