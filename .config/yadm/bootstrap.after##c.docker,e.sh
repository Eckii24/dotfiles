#!/bin/bash

set -eu

curl -s https://ohmyposh.dev/install.sh | bash -s -- -d /home/linuxbrew/.linuxbrew/bin

echo 'export PATH="$PATH:/home/linuxbrew/.linuxbrew/bin"' >> $HOME/.zshrc
