#!/bin/bash

echo "Starting setup for php..."

echo "Set YADM class php"
yadm config --add local.class php

echo "Install PHP composer..."
brew install composer

echo "Install phpactor..."
curl -Lo phpactor.phar https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar
chmod a+x phpactor.phar
mv phpactor.phar $(brew --prefix)/bin/phpactor
