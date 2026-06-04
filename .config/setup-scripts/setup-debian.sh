#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON_SH="$SCRIPT_DIR/lib/setup-common.sh"

if [ -f "$COMMON_SH" ]; then
  # shellcheck source=./lib/setup-common.sh
  . "$COMMON_SH"
else
  . <(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/lib/setup-common.sh)
fi

# Ensure contrib and non-free repositories are enabled
echo "Enabling contrib and non-free repositories..."
run_root sed -i '/^deb.* main non-free-firmware$/ s/$/ contrib non-free/' /etc/apt/sources.list

# Set time tzone to Europe/Berlin
echo "Setting timezone to Europe/Berlin..."
run_root timedatectl set-timezone Europe/Berlin

# Update system
echo "Updating system..."
run_root apt update && run_root apt upgrade -y

# Install dotfiles
echo "Installing dotfiles..."
run_root apt install -y curl git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-work.sh)"

echo "Basic Setup complete! Please restart the system."
