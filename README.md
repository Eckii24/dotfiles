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

The container should be accessed via SSH:
```bash
ssh-add

ssh -p 2222 root@localhost
```
## Instalaltion of debian

### Steps in the debian installer

1. Install
2. Configure language settings
3. Choose a hostname for the machine
4. Domain can be left empty
5. Don't assign a root password. The root user will then be disabled
6. Enter details about the user to be created. This user will have sudo privileges
7. Partition disks
  1. All files in one partition
  2. Leave everything as default
8. Scan additional media can be declined
9. Package mirror: Use germany and deb.debian.org without proxy
10. Choose software to install: Only standard system utilities

### Setup system

Make sure `curl` is available:
```bash
sudo apt install curl
```

After that the setup script can be run with the following command:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-debian.sh)"
```
