#!/bin/bash

echo "Starting setup for work environment on Linux..."

echo "Set YADM class work"
yadm config --add local.class work

echo "Install azure-cli"
# Install Azure CLI for Debian/Ubuntu
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
az extension add --name azure-devops

echo "Add user to docker group"
sudo groupadd docker
sudo usermod -aG docker "$USER"

echo "Installing dapr"
# Install Dapr CLI
curl -fsSL https://raw.githubusercontent.com/dapr/cli/master/install/install.sh | /bin/bash

echo "Init SQL server in docker and install sqlcmd"
sudo docker run -e 'ACCEPT_EULA=Y' -e 'MSSQL_SA_PASSWORD=Test_1234' -p 1433:1433 --name mssql_server -d mcr.microsoft.com/mssql/server:2022-latest

# Install sqlcmd for Linux
curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
curl -fsSL https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
sudo apt-get update
sudo ACCEPT_EULA=Y apt-get install -y mssql-tools18 unixodbc-dev

echo "Install redis-cli"
sudo apt-get install -y redis-tools

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"