echo "Install Aider..."
uv tool install --force --python python3.12 aider-chat@latest

echo "Install fabric..."
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')

if command -v sudo &>/dev/null && sudo -n true 2>/dev/null; then
  sudo curl -L "https://github.com/danielmiessler/fabric/releases/latest/download/fabric-$OS-$ARCH" -o /usr/local/bin/fabric
  sudo chmod +x /usr/local/bin/fabric
else
  curl -L "https://github.com/danielmiessler/fabric/releases/latest/download/fabric-$OS-$ARCH" -o /usr/local/bin/fabric
  chmod +x /usr/local/bin/fabric
fi
