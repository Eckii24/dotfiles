#!/bin/bash

set -e

# Ensure contrib and non-free repositories are enabled
echo "Enabling contrib and non-free repositories..."
sudo sed -i '/^deb.* main non-free-firmware$/ s/$/ contrib non-free/' /etc/apt/sources.list

# Disable grub timeout
echo "Disabling GRUB timeout..."
sudo sed -i 's/GRUB_TIMEOUT=[0-9]*/GRUB_TIMEOUT=0/' /etc/default/grub
sudo update-grub

# Set time tzone to Europe/Berlin
echo "Setting timezone to Europe/Berlin..."
sudo timedatectl set-timezone Europe/Berlin

# Update system
echo "Updating system..."
sudo apt update && sudo apt upgrade -y

# Install everything for the window manager
echo "Installing everything for the window manager..."
sudo apt install -y xorg xclip i3 rofi feh

# Install xrdp
echo "Installing xrdp..."
sudo apt install -y xrdp
sudo systemctl enable xrdp
echo -e "#!/bin/bash\nsource ~/.zshrc\ni3" > ~/.xsession

# Set config to ensure xrdp is performant
sudo sed -i '/^#tcp_send_buffer_bytes/s/^#//; s/tcp_send_buffer_bytes=.*/tcp_send_buffer_bytes=4194304/' /etc/xrdp/xrdp.ini
sudo sed -i 's/crypt_level=high/crypt_level=none/g' /etc/xrdp/xrdp.ini 
sudo sed -i 's/max_bpp=32/max_bpp=16/g' /etc/xrdp/xrdp.ini 
sudo echo "use_compression = yes" >> /etc/xrdp/xrdp.ini
sudo echo "net.core.wmem_max = 8388608" > /etc/sysctl.d/xrdp.conf

# Install Docker
echo "Installing Docker..."
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Install dotfiles
echo "Installing dotfiles..."
sudo apt install -y curl git
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-work.sh)"

# Install flatpak
echo "Installing Flatpak..."
sudo apt install -y flatpak
sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo

# Install JetBrains Toolbox
echo "Installing JetBrains Toolbox..."
curl -L https://download.jetbrains.com/toolbox/jetbrains-toolbox-2.5.3.37797.tar.gz -o /opt
sudo tar -xvzf /opt/jetbrains-toolbox-2.5.3.37797.tar.gz
sudo mv jetbrains-toolbox-1.21.9712 jetbrains

# Install Microsoft Edge
echo "Installing Microsoft Edge..."
sudo flatpak install -y flathub com.microsoft.Edge
sudo flatpak override com.microsoft.Edge --share=network

# Install Postman
echo "Installing Postman..."
sudo flatpak install -y flathub com.getpostman.Postman
sudo flatpak override com.getpostman.Postman --share=network

# Install OpenLens
echo "Installing OpenLens..."
curl -L https://github.com/MuhammedKalkan/OpenLens/releases/download/v6.5.2-366/OpenLens-6.5.2-366.amd64.deb -o /tmp/OpenLens.deb
sudo dpkg -i /tmp/OpenLens.deb
rm /tmp/OpenLens.deb

# Install snapd
sudo apt install snapd
sudo snap install snapd

## Install alacritty
sudo snap install alacritty --classic

# Install Mockoon
sudo snap install mockoon

# Install Zeebe Modeler
if ! command -v camunda-modeler &> /dev/null; then
    echo "Installing Zeebe Modeler..."
    curl -L https://downloads.camunda.cloud/release/camunda-modeler/5.31.0/camunda-modeler-5.31.0-linux-x64.tar.gz -o /tmp/camunda-modeler.tar.gz
    sudo mkdir -p /opt/camunda-modeler
    sudo tar -xzf /tmp/camunda-modeler.tar.gz -C /opt/camunda-modeler --strip-components=1
    sudo ln -sf /opt/camunda-modeler/camunda-modeler /usr/local/bin/camunda-modeler
    rm /tmp/camunda-modeler.tar.gz
else
    echo "Zeebe Modeler is already installed."
fi

# Install Hack Nerd Font
if [ ! -f "$HOME/.local/share/fonts/HackNerdFont-Regular.ttf" ]; then
    echo "Installing Hack Nerd Font..."
    FONT_DIR="$HOME/.local/share/fonts"
    mkdir -p $FONT_DIR
    curl -L https://github.com/ryanoasis/nerd-fonts/releases/latest/download/Hack.tar.xz -o "/tmp/Hack.tar.xz"
    tar -xJf "/tmp/Hack.tar.xz" -C $FONT_DIR
    fc-cache -fv
    rm "/tmp/Hack.tar.xz"
else
    echo "Hack Nerd Font is already installed."
fi

echo "Setup complete! Please restart the system."
