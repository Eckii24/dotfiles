# Dotfiles Repository - Development Environment Setup

Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.

## Working Effectively

### Initial Setup and Bootstrap
Run these commands to set up the complete development environment from a fresh system:

**Prerequisites:**
- Ensure `curl` and `git` are available: `sudo apt install curl git` (on Debian/Ubuntu)

**Main Setup Process:**
```bash
# NEVER CANCEL: Full setup takes 15-30 minutes depending on network speed and system. Set timeout to 45+ minutes.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup.sh)"
```

**For Work Environment (additional tools):**
```bash
# NEVER CANCEL: Work setup takes 10-15 minutes. Set timeout to 30+ minutes.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-work.sh)"
```

**For .NET Development:**
```bash
# NEVER CANCEL: .NET setup takes 5-10 minutes. Set timeout to 20+ minutes.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-dotnet.sh)"
```

**For Debian System Setup:**
```bash
# NEVER CANCEL: System setup takes 20-40 minutes. Set timeout to 60+ minutes.
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Eckii24/dotfiles/refs/heads/master/.config/setup-scripts/setup-debian.sh)"
```

### Manual YADM Operations
After initial setup, you can use YADM directly for dotfiles management:

```bash
# Update dotfiles and re-run bootstrap
# NEVER CANCEL: Bootstrap takes 10-20 minutes. Set timeout to 30+ minutes.
yadm pull
yadm bootstrap

# Check status of dotfiles
yadm status

# Add new dotfiles to tracking
yadm add <file>
yadm commit -m "Add new config"
yadm push
```

### Development Environment Validation
Always run these validation steps after setup or making changes:

**Basic Environment Check:**
```bash
# Verify shell setup
echo $SHELL  # Should show /usr/bin/zsh or similar
zsh --version

# Verify key tools are installed
which nvim git fzf bat eza delta lazygit
oh-my-posh --version
```

**Neovim Validation:**
```bash
# Test Neovim starts and plugins are working
# NEVER CANCEL: Plugin sync can take 5-10 minutes on first run. Set timeout to 15+ minutes.
nvim --headless "+checkhealth" +qa
nvim --headless "+Lazy! sync" +qa
```

**Development Tools Check:**
```bash
# For .NET development
dotnet --version
dotnet tool list -g

# For Node.js development  
node --version
npm --version

# For Git workflow
git --version
lazygit --version
```

## Docker Development Environments

The repository provides pre-configured Docker environments for isolated development:

### Available Images
- `eckii24/dev-base:latest` - Base development environment
- `eckii24/dev-dotnet:latest` - .NET development environment  
- `eckii24/dev-php:latest` - PHP development environment
- `eckii24/dev-work:latest` - Work environment with additional tools

### Running Docker Environment
```bash
# Start development container
docker run --rm -d \
  -p 2222:22 \
  -v ~/.ssh/id_rsa.pub:/root/.ssh/authorized_keys:ro \
  -v /path/to/project:/root/workspace \
  eckii24/dev-base:latest

# Connect via SSH
ssh-add
ssh -p 2222 root@localhost
```

### Building Docker Images
```bash
# NEVER CANCEL: Docker builds take 10-45 minutes depending on image. Set timeout to 60+ minutes.
docker build -t eckii24/dev-base:latest -f .config/setup-scripts/base.Dockerfile .
docker build -t eckii24/dev-dotnet:latest -f .config/setup-scripts/dotnet.Dockerfile .
```

## Repository Structure and Key Locations

### Critical Configuration Directories
- `.config/yadm/` - YADM bootstrap scripts and configuration
- `.config/yadm/bootstrap.d/` - Modular bootstrap scripts (run in numerical order)
- `.config/setup-scripts/` - Platform-specific setup scripts
- `.config/nvim/` - Neovim configuration (LazyVim-based)
- `.config/zsh/` - Zsh configuration and custom functions
- `.config/git/` - Git configuration and pre-commit hooks

### Important Files
- `.config/yadm/packages-linux.txt` - Linux packages installed via apt
- `.config/yadm/bootstrap` - Main bootstrap script that runs all others
- `.config/setup-scripts/setup.sh` - Main entry point for fresh installations
- `.zshrc` - Main zsh configuration file

### Bootstrap Process Flow
1. `setup.sh` downloads temporary YADM and clones repository
2. YADM runs `.config/yadm/bootstrap` 
3. Bootstrap runs all executable scripts in `bootstrap.d/` in order:
   - `100-*` scripts: Install packages and basic tools
   - `200-*` scripts: Configure environment, shell, and applications

## Validation Scenarios

### Complete End-to-End Validation
After making changes, always test this complete scenario:

1. **Terminal Functionality:**
```bash
# Test shell and prompt
zsh
# Should show oh-my-posh themed prompt
echo "Terminal working: $(date)"
```

2. **File Navigation:**
```bash
# Test modern Unix tools
eza -la  # Enhanced ls
fd "*.md"  # Fast find
rg "setup" --type md  # Ripgrep search
bat README.md  # Syntax highlighting
```

3. **Git Workflow:**
```bash
# Test git integration
git status
git log --oneline -5
# Launch lazygit (should work without errors)
lazygit --help
```

4. **Development Environment:**
```bash
# Test Neovim with project
cd /tmp && mkdir test-project && cd test-project
echo "# Test" > README.md
nvim README.md
# Should open with LazyVim interface and syntax highlighting
```

5. **Code Quality Tools:**
```bash
# Test pre-commit setup
init-pre-commit  # Custom alias for pre-commit setup
pre-commit --version
```

## Platform-Specific Notes

### Linux/WSL
- Uses apt package manager for base packages
- Homebrew (Linuxbrew) for additional tools
- Requires `build-essential` for compilation

### macOS  
- Uses Homebrew as primary package manager
- Requires Command Line Tools: `xcode-select --install`

### Windows/WSL
- Requires WSL2 setup
- Install on Windows level: `choco install wezterm nerd-fonts-hack`

## Timing Expectations and Warnings

**CRITICAL - NEVER CANCEL these operations:**

- **Full setup (`setup.sh`)**: 15-30 minutes - NEVER CANCEL, set timeout to 45+ minutes
- **Work setup**: 10-15 minutes - NEVER CANCEL, set timeout to 30+ minutes  
- **Bootstrap process**: 10-20 minutes - NEVER CANCEL, set timeout to 30+ minutes
- **Neovim plugin sync**: 5-10 minutes on first run - NEVER CANCEL, set timeout to 15+ minutes
- **Docker base image build**: 10-30 minutes - NEVER CANCEL, set timeout to 45+ minutes
- **Docker specialized builds**: 5-15 minutes each - NEVER CANCEL, set timeout to 30+ minutes
- **.NET SDK installation**: 5-10 minutes - NEVER CANCEL, set timeout to 20+ minutes

## Common Tasks

### Adding New Dotfiles
```bash
# Track new configuration file
yadm add ~/.config/newapp/config.yaml
yadm commit -m "Add newapp configuration"
yadm push
```

### Updating Development Environment
```bash
# Pull latest changes and re-bootstrap
yadm pull
# NEVER CANCEL: Re-bootstrap takes 10-20 minutes. Set timeout to 30+ minutes.
yadm bootstrap
```

### Working with Different Environments
YADM supports conditional configurations using classes:

```bash
# Set work environment class
yadm config --add local.class work

# Set dotnet development class  
yadm config --add local.class dotnet

# Check current classes
yadm config local.class
```

### Troubleshooting
```bash
# Check YADM status and conflicts
yadm status
yadm diff

# Restart shell after changes
exec zsh

# Reset Neovim plugins if issues occur
rm -rf ~/.local/share/nvim
# NEVER CANCEL: Plugin reinstall takes 5-10 minutes. Set timeout to 15+ minutes.
nvim --headless "+Lazy! sync" +qa
```

## Pre-commit and Code Quality

Always run these before committing changes:
```bash
# Setup pre-commit hooks (use the custom alias)
pc  # Alias for init-pre-commit

# Manually run pre-commit
pre-commit run --all-files
```

## Key Scripts Reference

**Immediate verification commands to run after setup:**
```bash
# Quick environment check (should all succeed)
echo $SHELL && zsh --version && nvim --version && git --version
oh-my-posh --version && fzf --version && bat --version
```

**Bootstrap script locations for debugging:**
- Package installation: `.config/yadm/bootstrap.d/bootstrap.100-install-packages.sh##os.WSL,e.sh`
- Shell setup: `.config/yadm/bootstrap.d/bootstrap.200-set-default-shell.sh`
- Neovim setup: `.config/yadm/bootstrap.d/bootstrap.200-setup-neovim.sh`
- Oh-My-Posh: `.config/yadm/bootstrap.d/bootstrap.200-install-ohmyposh.sh`

**Always verify functionality after any changes by running the validation scenarios above.**