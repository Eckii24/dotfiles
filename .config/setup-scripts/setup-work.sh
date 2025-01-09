#!/bin/bash

echo "Starting setup for work environment..."

echo "Set YADM class work"
yadm config --add local.class work

echo "Calling setup dotnet..."
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
