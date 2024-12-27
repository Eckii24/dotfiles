
#!/bin/bash

echo "Starting setup..."

# Download and temporarily install YADM
install_temp_yadm() {
    echo "Installing temporary YADM..."
    curl -fLo /tmp/yadm https://github.com/yadm-dev/yadm/raw/master/yadm
    chmod +x /tmp/yadm
}

# Set additional YADM classes if YADM_CLASSES environment variable is set
set_yadm_classes() {
    if [ -n "$YADM_CLASSES" ]; then
        for class in "$YADM_CLASSES"; do
            echo "Adding YADM class: $class"
            /tmp/yadm config --add local.class "$class"
        done
    fi
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

# Install temporary YADM, set classes, clone dotfiles, and clean up
if ! command -v yadm &>/dev/null; then
    install_temp_yadm
    set_yadm_classes
    clone_dotfiles
    cleanup_temp_yadm
else
    echo "YADM is already installed. Cloning dotfiles..."
    set_yadm_classes
    clone_dotfiles
fi

echo "Setup complete!"


