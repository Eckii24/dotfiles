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
if ! command -v sqlcmd &>/dev/null; then
  echo "Installing sqlcmd..."
  sqlcmd_version=$(curl -s https://github.com/microsoft/go-sqlcmd/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  curl -L "https://github.com/microsoft/go-sqlcmd/releases/download/${sqlcmd_version}/sqlcmd-linux-amd64.tar.bz2" -o /tmp/sqlcmd.tar.bz2
  tar -xjf /tmp/sqlcmd.tar.gz -C /tmp/
  mv /tmp/sqlcmd "$HOME/.local/bin/"
  chmod +x "$HOME/.local/bin/sqlcmd"
  rm /tmp/sqlcmd.tar.bz2
fi

echo "Install redis-cli"
sudo apt-get install -y redis-tools

echo "Install mockoon-cli"
sudo -E npm install -g @mockoon/cli

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
