#!/bin/bash

echo "Starting setup for work environment..."

# Function to add Homebrew to PATH
if ! command -v brew &>/dev/null; then
  echo "Homebrew not found. Adding to PATH..."
  if [[  -x "/opt/homebrew/bin/brew"  ]]; then
    # Apple Silicon (ARM)
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[  -x "/usr/local/bin/brew"  ]]; then
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  elif [[  -x "/home/linuxbrew/.linuxbrew/bin/brew"  ]]; then
    # Linux
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  else
    echo "Homebrew not found. Exiting..."
    exit 1
  fi
else
  echo "Homebrew already added to PATH."
fi

echo "Set YADM class work"
yadm config --add local.class work

echo "Install azure-cli"
brew install azure-cli

echo "Add user to docker group"
sudo groupadd docker
sudo usermod -aG docker $USER

echo "Installing dapr"
if ! command -v dapr &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/dapr/cli/master/install/install.sh)"
  dapr init
else
  echo "dapr is already installed."
fi

echo "Init SQL server in docker"
sudo docker run -e 'ACCEPT_EULA=Y' -e 'MSSQL_SA_PASSWORD=Test_1234' -p 1433:1433 --name mssql_server -d mcr.microsoft.com/mssql/server:2022-latest

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
