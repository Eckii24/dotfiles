#!/bin/bash

echo "Starting setup..."

# Download and temporarily install YADM
install_temp_yadm() {
    echo "Installing temporary YADM..."
    curl -fLo /tmp/yadm https://github.com/yadm-dev/yadm/raw/master/yadm
    chmod +x /tmp/yadm
}

# Clone dotfiles and invoke bootstrap
clone_dotfiles() {
    echo "Cloning dotfiles with temporary YADM..."
    /tmp/yadm clone https://github.com/Eckii24/dotfiles.git --bootstrap
}

# Cleanup temporary YADM
cleanup_temp_yadm() {
    echo "Cleaning up temporary YADM..."
    rm -f /tmp/yadm
}

# Install temporary YADM, clone dotfiles, and clean up
if ! command -v yadm &>/dev/null; then
    install_temp_yadm
    clone_dotfiles
    cleanup_temp_yadm
else
    echo "YADM is already installed. Cloning dotfiles..."
    clone_dotfiles
fi

echo "Setup complete!"

