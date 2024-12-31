echo $(which zsh) | tree -a /etc/shells > /dev/null
chsh -s $(Which zsh)
