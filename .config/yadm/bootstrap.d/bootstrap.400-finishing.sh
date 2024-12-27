
#!/bin/bash

set -eu

source $HOME/.config/yadm/bootstrap.d/bootstrap_functions##class.never,e.sh

echo "Updating the yadm repo origin URL"
$(brew -prefix)/bin/yadm remote set-url origin "git@github.com:Eckii24/dotfiles.git"

echo "Install Neovim plugins"
$(brew --prefix)/bin/nvim --headless "+Lazy! sync" +qa

echo "Finishing up bootstrapping"
