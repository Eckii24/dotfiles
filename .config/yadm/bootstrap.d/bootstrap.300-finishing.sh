
#!/bin/bash

set -eu

echo "Updating the yadm repo origin URL"
yadm remote set-url origin "git@github.com:Eckii24/dotfiles.git"

echo "Install Neovim plugins"
nvim --headless "+Lazy! sync" +qa

echo "Finishing up bootstrapping"
