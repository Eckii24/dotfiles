#!/bin/bash

set -eu

echo "Installing packages for Linux using apt..."

# Update package lists
echo "Updating package lists..."
if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
    sudo apt-get update
else
    apt-get update
fi

# Function to install apt packages
install_apt_packages() {
    local packages_file="$HOME/.config/yadm/packages-linux.txt"
    if [[ -f "$packages_file" ]]; then
        echo "Installing packages from $packages_file..."
        # Read packages from file, filter out comments and empty lines
        local packages=$(grep -v '^#' "$packages_file" | grep -v '^$' | tr '\n' ' ')
        
        if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
            sudo apt-get install -y $packages
        else
            apt-get install -y $packages
        fi
    else
        echo "No packages file found at $packages_file. Skipping apt package installation."
    fi
}

# Function to install packages from GitHub releases
install_github_packages() {
    local bin_dir="$HOME/.local/bin"
    mkdir -p "$bin_dir"
    
    # Install eza
    if ! command -v eza &>/dev/null; then
        echo "Installing eza..."
        local eza_version=$(curl -s https://api.github.com/repos/eza-community/eza/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/eza-community/eza/releases/download/${eza_version}/eza_x86_64-unknown-linux-gnu.tar.gz" -o /tmp/eza.tar.gz
        tar -xzf /tmp/eza.tar.gz -C /tmp/
        mv /tmp/eza "$bin_dir/"
        chmod +x "$bin_dir/eza"
        rm /tmp/eza.tar.gz
    fi
    
    # Install git-delta
    if ! command -v delta &>/dev/null; then
        echo "Installing git-delta..."
        local delta_version=$(curl -s https://api.github.com/repos/dandavison/delta/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/dandavison/delta/releases/download/${delta_version}/delta-${delta_version}-x86_64-unknown-linux-gnu.tar.gz" -o /tmp/delta.tar.gz
        tar -xzf /tmp/delta.tar.gz -C /tmp/
        mv "/tmp/delta-${delta_version}-x86_64-unknown-linux-gnu/delta" "$bin_dir/"
        chmod +x "$bin_dir/delta"
        rm -rf /tmp/delta.tar.gz "/tmp/delta-${delta_version}-x86_64-unknown-linux-gnu"
    fi
    
    # Install lazydocker
    if ! command -v lazydocker &>/dev/null; then
        echo "Installing lazydocker..."
        local lazydocker_version=$(curl -s https://api.github.com/repos/jesseduffield/lazydocker/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/jesseduffield/lazydocker/releases/download/${lazydocker_version}/lazydocker_${lazydocker_version#v}_Linux_x86_64.tar.gz" -o /tmp/lazydocker.tar.gz
        tar -xzf /tmp/lazydocker.tar.gz -C /tmp/
        mv /tmp/lazydocker "$bin_dir/"
        chmod +x "$bin_dir/lazydocker"
        rm /tmp/lazydocker.tar.gz
    fi
    
    # Install lazygit
    if ! command -v lazygit &>/dev/null; then
        echo "Installing lazygit..."
        local lazygit_version=$(curl -s https://api.github.com/repos/jesseduffield/lazygit/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/jesseduffield/lazygit/releases/download/${lazygit_version}/lazygit_${lazygit_version#v}_Linux_x86_64.tar.gz" -o /tmp/lazygit.tar.gz
        tar -xzf /tmp/lazygit.tar.gz -C /tmp/
        mv /tmp/lazygit "$bin_dir/"
        chmod +x "$bin_dir/lazygit"
        rm /tmp/lazygit.tar.gz
    fi
    
    # Install zoxide
    if ! command -v zoxide &>/dev/null; then
        echo "Installing zoxide..."
        curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
    fi
    
    # Install zellij
    if ! command -v zellij &>/dev/null; then
        echo "Installing zellij..."
        local zellij_version=$(curl -s https://api.github.com/repos/zellij-org/zellij/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/zellij-org/zellij/releases/download/${zellij_version}/zellij-x86_64-unknown-linux-musl.tar.gz" -o /tmp/zellij.tar.gz
        tar -xzf /tmp/zellij.tar.gz -C /tmp/
        mv /tmp/zellij "$bin_dir/"
        chmod +x "$bin_dir/zellij"
        rm /tmp/zellij.tar.gz
    fi
    
    # Install uv
    if ! command -v uv &>/dev/null; then
        echo "Installing uv..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
    fi
    
    # Install Bob (Neovim version manager)
    if ! command -v bob &>/dev/null; then
        echo "Installing Bob (Neovim version manager)..."
        curl -sSf https://raw.githubusercontent.com/MordechaiHadad/bob/master/install | bash -s -- --to "$bin_dir"
    fi
    
    # Install aichat
    if ! command -v aichat &>/dev/null; then
        echo "Installing aichat..."
        local aichat_version=$(curl -s https://api.github.com/repos/sigoden/aichat/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
        curl -L "https://github.com/sigoden/aichat/releases/download/${aichat_version}/aichat-${aichat_version}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/aichat.tar.gz
        tar -xzf /tmp/aichat.tar.gz -C /tmp/
        mv "/tmp/aichat-${aichat_version}-x86_64-unknown-linux-musl/aichat" "$bin_dir/"
        chmod +x "$bin_dir/aichat"
        rm -rf /tmp/aichat.tar.gz "/tmp/aichat-${aichat_version}-x86_64-unknown-linux-musl"
    fi
    
    # Install yadm
    if ! command -v yadm &>/dev/null; then
        echo "Installing yadm..."
        curl -fLo "$bin_dir/yadm" https://github.com/yadm-dev/yadm/raw/master/yadm
        chmod +x "$bin_dir/yadm"
    fi
}

# Function to install Python packages
install_python_packages() {
    echo "Installing Python packages..."
    uv tool install pre-commit
}

# Function to install Node packages
install_node_packages() {
    echo "Installing Node packages..."
    npm install -g repomix
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