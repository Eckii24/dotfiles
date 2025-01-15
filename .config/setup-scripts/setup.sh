#!/bin/bash

echo "Starting setup..."

# Download and temporarily install YADM
install_temp_yadm() {
    echo "Installing temporary YADM..."
    curl -fLo /tmp/yadm https://github.com/yadm-dev/yadm/raw/master/yadm
    chmod +x /tmp/yadm
}

# Function to check if the repository is already cloned
is_repo_cloned() {
    if [ -d "$HOME/.local/share/yadm/repo.git" ]; then
        return 0 # Repo is already cloned
    else
        return 1 # Repo is not cloned
    fi
}

# Clone dotfiles and invoke bootstrap
clone_dotfiles() {
    echo "Cloning dotfiles with temporary YADM..."
    /tmp/yadm clone https://github.com/Eckii24/dotfiles.git --bootstrap
}

# Function to pull updates and invoke bootstrap
update_dotfiles() {
    echo "Pulling updates and invoking bootstrap..."
    /tmp/yadm checkout master
    /tmp/yadm pull --rebase
    /tmp/yadm bootstrap
}

# Cleanup temporary YADM
cleanup_temp_yadm() {
    echo "Cleaning up temporary YADM..."
    rm -f /tmp/yadm
}

# Install temporary YADM, clone dotfiles, and clean up
install_temp_yadm

if is_repo_cloned; then
    echo "Dotfiles are already cloned. Updating..."
    update_dotfiles
else
    echo "Dotfiles are not cloned. Cloning..."
    clone_dotfiles
fi

cleanup_temp_yadm

echo "Setup complete!"

