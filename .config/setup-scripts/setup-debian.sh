#!/bin/bash

set -e

# Ensure contrib and non-free repositories are enabled
echo "Enabling contrib and non-free repositories..."
sudo sed -i '/^deb.* main non-free-firmware$/ s/$/ contrib non-free/' /etc/apt/sources.list

# Set time tzone to Europe/Berlin
echo "Setting timezone to Europe/Berlin..."
sudo timedatectl set-timezone Europe/Berlin

# Update system
echo "Updating system..."
sudo apt update && sudo apt upgrade -y

# Install dotfiles
echo "Installing dotfiles..."
sudo apt install -y curl git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-work.sh)"

echo "Basic Setup complete! Please restart the system."
