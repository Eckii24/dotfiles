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

# Install everything for the window manager
echo "Installing everything for the window manager..."
sudo apt install -y  xorg i3 lightdm lightdm-gtk-greeter rofi feh
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
sudo ln -sf /var/lib/flatpak/exports/bin/org.wezfurlong.wezterm /usr/local/bin/wezterm

# Install JetBrains Rider
echo "Installing JetBrains Rider..."
sudo flatpak install -y flathub com.jetbrains.Rider
sudo ln -sf /var/lib/flatpak/exports/bin/com.jetbrains.Rider /usr/local/bin/rider

# Install Microsoft Edge
echo "Installing Microsoft Edge..."
sudo flatpak install -y flathub com.microsoft.Edge
sudo ln -sf /var/lib/flatpak/exports/bin/com.microsoft.Edge /usr/local/bin/edge

# Install Postman
echo "Installing Postman..."
sudo flatpak install -y flathub com.getpostman.Postman
sudo ln -sf /var/lib/flatpak/exports/bin/com.getpostman.Postman /usr/local/bin/postman

# Install OpenLens
echo "Installing OpenLens..."
sudo flatpak install -y flathub dev.k8slens.OpenLens
sudo ln -sf /var/lib/flatpak/exports/bin/dev.k8slens.OpenLens /usr/local/bin/openlens

# Install Mockoon
echo "Installing Mockoon..."
curl -L https://github.com/mockoon/mockoon/releases/download/v9.1.0/mockoon-9.1.0.amd64.deb -o /tmp/mockoon.deb
sudo apt install -y /tmp/mockoon.deb
rm /tmp/mockoon.deb

# Install Zeebe Modeler
echo "Installing Zeebe Modeler..."
curl -L https://downloads.camunda.cloud/release/camunda-modeler/5.31.0/camunda-modeler-5.31.0-linux-x64.tar.gz -o /tmp/camunda-modeler.tar.gz
sudo mkdir -p /opt/camunda-modeler
sudo tar -xzf /tmp/camunda-modeler.tar.gz -C /opt/camunda-modeler --strip-components=1
sudo ln -sf /opt/camunda-modeler/camunda-modeler /usr/local/bin/camunda-modeler
rm /tmp/camunda-modeler.tar.gz

# Install Hack Nerd Font
echo "Installing Hack Nerd Font..."
FONT_DIR="$HOME/.local/share/fonts"
mkdir -p $FONT_DIR
curl -L https://github.com/ryanoasis/nerd-fonts/releases/latest/download/Hack.tar.xz -o "/tmp/Hack.tar.xz"
tar -xJf "/tmp/Hack.tar.xz" -C $FONT_DIR
fc-cache -fv
rm "/tmp/Hack.tar.xz"

echo "Setup complete! Please restart the system."
