#!/bin/bash

echo "Starting PHP setup for Linux..."

echo "Installing PHP and Composer..."
sudo apt-get update
sudo apt-get install -y php php-cli php-curl php-mbstring php-xml php-zip

# Install Composer
curl -sS https://getcomposer.org/installer | php
sudo mv composer.phar /usr/local/bin/composer
chmod +x /usr/local/bin/composer

echo "Set YADM class php"
yadm config --add local.class php

echo "Install PHPActor..."
mkdir -p "$HOME/.local/bin"
curl -Lo "$HOME/.local/bin/phpactor" https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar
chmod +x "$HOME/.local/bin/phpactor"

echo "Sync Neovim plugins..."
~/.local/share/bob/nvim-bin/nvim --headless "+Lazy! sync" +qa

echo "PHP setup complete!"