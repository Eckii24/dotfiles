#!/bin/bash

echo "Starting .NET setup for Linux..."

# Install .NET SDK for Ubuntu/Debian
echo "Installing .NET SDK..."
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl -fsSL https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/packages-microsoft-prod.deb -o packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
rm packages-microsoft-prod.deb

sudo apt-get update
sudo apt-get install -y dotnet-sdk-8.0 dotnet-sdk-9.0

echo "Set YADM class dotnet"
yadm config --add local.class dotnet

echo "Install dotnet tools..."
dotnet tool install -g csharpier
dotnet tool install -g dotnet-outdated-tool
dotnet tool install -g dotnet-ef
dotnet tool install -g JetBrains.ReSharper.GlobalTools

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa

echo ".NET setup complete!"