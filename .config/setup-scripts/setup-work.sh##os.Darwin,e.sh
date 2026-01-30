#!/bin/bash

echo "Starting setup for work environment..."

echo "Set YADM class work and dotnet"
yadm config --add local.class work
yadm config --add local.class dotnet

echo "Install further brew packages for work..."
brew bundle --file="$HOME/.config/setup-scripts/work/Brewfile"

echo "Install azure-cli extensions"
az extension add --name azure-devops

echo "Init SQL server in docker and sqlcmd"
sudo docker run -e 'ACCEPT_EULA=Y' -e 'MSSQL_SA_PASSWORD=Test_1234' -p 1433:1433 --name mssql_server -d mcr.microsoft.com/mssql/server:2022-latest

echo "Install bugwarrior"
uv tool install bugwarrior -w setuptools --force

echo "Install mockoon-cli"
sudo npm install -g @mockoon/cli

echo "Install dotnet tools..."
dotnet tool install -g csharpier
dotnet tool install -g dotnet-outdated-tool
dotnet tool install -g dotnet-ef

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa
