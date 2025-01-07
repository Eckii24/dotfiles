# dotfiles

This repository contains my dotfiles to setup my development environment.

## Installation

Just execute the following command:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"
```

HINT: Make sure curl and git are available, when executing the command.

### Before installation on windows/WLS

Install the required tools on windows level:
```pwsh
choco install wezterm
choco install nerd-fonts-hack
```

## Docker enviroments

The repo also provides preconfigured docker files to work inside them.

```bash
docker run --rm -d \
  -p 2222:22 \
  -v ~/.ssh/<id-file>.pub:/root/.ssh/authorized_keys:ro \
  -v <path-to-project>:/root/ \
  eckii24/dev-base:latest
```
