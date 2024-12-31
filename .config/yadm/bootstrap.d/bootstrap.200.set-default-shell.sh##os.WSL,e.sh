echo $(which zsh) | sudo tree -a /etc/shells > /dev/null
chsh -s $(Which zsh)
