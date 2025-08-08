echo "Install VectorCode..."
uv tool install --force 'vectorcode[lsp,mcp]'
echo "Run docker compose -f $HOME/.config/vectorcode/docker-compose.yaml up -d manually to start the chromadb for vectorcode."

echo "Install OpenCode"
curl -fsSL https://opencode.ai/install | bash
