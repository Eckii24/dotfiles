#!/bin/bash

set -eu

echo "Install tmux plugin manager"
mkdir -p "$HOME"/.config/tmux/plugins
git clone https://github.com/tmux-plugins/tpm "$HOME"/.config/tmux/plugins/tpm
tmux source "$HOME"/.config/tmux/tmux.conf
