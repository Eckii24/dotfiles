# dotfiles

This repository contains my dotfiles to setup my development environment.

## Installation

Just execute the following command:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/yadm/setup.sh)"
```

HINT: Make sure curl and git are available, when executing the command.

### Set zsh as default shell

You might wanna set zsh as your default shell. To do so, execute the following command:
```bash
ZSH_PATH=$(which zsh)

if ! grep -Fxq "$ZSH_PATH" /etc/shells; then
  echo "$ZSH_PATH" | sudo tee -a /etc/shells > /dev/null
fi

chsh -s "$ZSH_PATH"
```

### Before installation on windows/WLS

Install the required tools on windows level:
```pwsh
choco install wezterm
choco install nerd-fonts-hack
```
