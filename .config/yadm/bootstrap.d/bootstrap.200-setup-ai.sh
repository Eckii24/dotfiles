echo "Install Aider..."
uv tool install --force --python python3.12 aider-chat@latest

echo "Install fabric..."
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')

curl -L "https://github.com/danielmiessler/fabric/releases/latest/download/fabric-$OS-$ARCH" -o ~/.local/bin/fabric
chmod +x ~/.local/bin/fabric

echo "Install VectorCode..."
uv tool install --force 'vectorcode[lsp,mcp]'
echo "Run docker compose -f $HOME/.config/vectorcode/docker-compose.yaml up -d manually to start the chromadb for vectorcode."
