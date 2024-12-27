#!/bin/bash

set -eu

apt install unzip
curl -s https://ohmyposh.dev/install.sh | bash -s -- -d /home/linuxbrew/.linuxbrew/bin
