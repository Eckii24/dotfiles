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

# Update system
echo "Updating system..."
run_root apt update && run_root apt upgrade -y

# Install Docker
echo "Installing Docker..."
run_root apt-get install ca-certificates curl
run_root install -m 0755 -d /etc/apt/keyrings
run_root curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
run_root chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  run_root tee /etc/apt/sources.list.d/docker.list > /dev/null
run_root apt-get update
run_root apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Run base Debian setup
echo "Installing dotfiles..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-debian.sh)"

# Disable grub timeout
echo "Disabling GRUB timeout..."
run_root sed -i 's/GRUB_TIMEOUT=[0-9]*/GRUB_TIMEOUT=0/' /etc/default/grub
run_root update-grub

# Install everything for the window manager
echo "Installing everything for the window manager..."
run_root apt install -y xorg xclip i3 rofi feh

# Install xrdp
echo "Installing xrdp..."
run_root apt install -y xrdp
run_root systemctl enable xrdp
echo -e "#!/bin/bash\nsource ~/.zshrc\ni3" >~/.xsession

# Set config to ensure xrdp is performant
run_root sed -i '/^#tcp_send_buffer_bytes/s/^#//; s/tcp_send_buffer_bytes=.*/tcp_send_buffer_bytes=4194304/' /etc/xrdp/xrdp.ini
run_root sed -i 's/crypt_level=high/crypt_level=none/g' /etc/xrdp/xrdp.ini
run_root sed -i 's/max_bpp=32/max_bpp=16/g' /etc/xrdp/xrdp.ini
echo "use_compression = yes" | run_root tee -a /etc/xrdp/xrdp.ini > /dev/null
echo "XRDP_XORG_TOUCHPAD_SCROLL_HACK=yes" | run_root tee -a /etc/xrdp/sesman.ini > /dev/null
echo "net.core.wmem_max = 8388608" | run_root tee /etc/sysctl.d/xrdp.conf > /dev/null

# Install JetBrains Toolbox
echo "Installing JetBrains Toolbox..."
curl -L https://download.jetbrains.com/toolbox/jetbrains-toolbox-2.5.3.37797.tar.gz -o /opt
run_root tar -xvzf /opt/jetbrains-toolbox-2.5.3.37797.tar.gz
run_root mv jetbrains-toolbox-1.21.9712 jetbrains

# Install Microsoft Edge
echo "Installing Microsoft Edge..."
curl -L https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/b87c27d1-4fe3-4145-a804-24deda351ae4/MicrosoftEdgePolicyTemplates.cab -o /tmp/Edge.deb
run_root dpkg -i /tmp/Edge.deb
rm /tmp/Edge.deb

# Install OpenLens
echo "Installing OpenLens..."
curl -L https://github.com/MuhammedKalkan/OpenLens/releases/download/v6.5.2-366/OpenLens-6.5.2-366.amd64.deb -o /tmp/OpenLens.deb
run_root dpkg -i /tmp/OpenLens.deb
rm /tmp/OpenLens.deb

# Install snapd
echo "Installing Snapd..."
run_root apt install snapd
run_root snap install snapd

# Install Ghostty
echo "Installing Ghostty..."
run_root snap install ghostty --classic

# Install Postman
echo "Installing Postman..."
run_root snap install postman

# Install Mockoon
echo "Installing Mockoon..."
run_root snap install mockoon

# Install VSCode Insiders
echo "Installing VSCode Insiders..."
run_root snap install code-insiders --classic

# Install Zeebe Modeler
if ! command -v camunda-modeler &>/dev/null; then
  echo "Installing Zeebe Modeler..."
  curl -L https://downloads.camunda.cloud/release/camunda-modeler/5.31.0/camunda-modeler-5.31.0-linux-x64.tar.gz -o /tmp/camunda-modeler.tar.gz
  run_root mkdir -p /opt/camunda-modeler
  run_root tar -xzf /tmp/camunda-modeler.tar.gz -C /opt/camunda-modeler --strip-components=1
  run_root ln -sf /opt/camunda-modeler/camunda-modeler /usr/local/bin/camunda-modeler
  rm /tmp/camunda-modeler.tar.gz
else
  echo "Zeebe Modeler is already installed."
fi

# Install Hack Nerd Font
if [ ! -f "$HOME/.local/share/fonts/HackNerdFont-Regular.ttf" ]; then
  echo "Installing Hack Nerd Font..."
  FONT_DIR="$HOME/.local/share/fonts"
  mkdir -p "$FONT_DIR"
  curl -L https://github.com/ryanoasis/nerd-fonts/releases/latest/download/Hack.tar.xz -o "/tmp/Hack.tar.xz"
  tar -xJf "/tmp/Hack.tar.xz" -C "$FONT_DIR"
  fc-cache -fv
  rm "/tmp/Hack.tar.xz"
else
  echo "Hack Nerd Font is already installed."
fi

echo "UI setup complete! Please restart the system."
