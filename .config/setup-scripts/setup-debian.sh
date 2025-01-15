#!/bin/bash

set -e

# Ensure contrib and non-free repositories are enabled
echo "Enabling contrib and non-free repositories..."
sudo sed -i '/^deb.* main non-free-firmware$/ s/$/ contrib non-free/' /etc/apt/sources.list

# Disable grub timeout
echo "Disabling GRUB timeout..."
sudo sed -i 's/GRUB_TIMEOUT=[0-9]*/GRUB_TIMEOUT=0/' /etc/default/grub
sudo update-grub

# Update system
echo "Updating system..."
sudo apt update && sudo apt upgrade -y

# Install Xorg, i3 and lightdm
echo "Installing Xorg, i3, and lightdm..."
sudo apt install -y  xorg i3 lightdm lightdm-gtk-greeter
sudo systemctl enable lightdm

# Install Docker
echo "Installing Docker..."
sudo apt install -y docker.io
sudo systemctl enable docker

# Install dotfiles
echo "Installing dotfiles..."
sudo apt install -y curl git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"

# Install flatpak
echo "Installing Flatpak..."
sudo apt install -y flatpak
sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo

# Install wezterm
echo "Installing WezTerm..."
sudo flatpak install -y flathub org.wezfurlong.wezterm

# Install JetBrains Rider
echo "Installing JetBrains Rider..."
sudo flatpak install -y flathub com.jetbrains.Rider

# Install Microsoft Edge
echo "Installing Microsoft Edge..."
sudo flatpak install -y flathub com.microsoft.Edge

# Install Postman
echo "Installing Postman..."
sudo flatpak install -y flathub com.getpostman.Postman

# Install Mockoon
echo "Installing Mockoon..."
curl -L https://github.com/mockoon/mockoon/releases/latest/download/mockoon-linux-x64.deb -o /tmp/mockoon.deb
sudo apt install -y /tmp/mockoon.deb
rm /tmp/mockoon.deb

# Install Zeebe Modeler
echo "Installing Zeebe Modeler..."
curl -L https://github.com/camunda/zeebe-modeler/releases/latest/download/zeebe-modeler-linux-x64.tar.gz -o /tmp/zeebe-modeler.tar.gz
sudo mkdir -p /opt/zeebe-modeler
sudo tar -xzf /tmp/zeebe-modeler.tar.gz -C /opt/zeebe-modeler --strip-components=1
sudo ln -sf /opt/zeebe-modeler/zeebe-modeler /usr/local/bin/zeebe-modeler
rm /tmp/zeebe-modeler.tar.gz

echo "Setup complete! Please restart the system."
