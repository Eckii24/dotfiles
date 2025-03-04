
#!/bin/bash

# Define the path to zsh
ZSH_PATH=$(command -v zsh)

# Check if zsh is installed
if [ -z "$ZSH_PATH" ]; then
  echo "zsh is not installed. Please install zsh and try again."
  exit 1
fi

# Check the current default shell
CURRENT_SHELL=$(basename "$SHELL")
if [ "$CURRENT_SHELL" = "zsh" ]; then
  echo "The default shell is already zsh."
  exit 0
fi

# Check if zsh is in /etc/shells
if ! grep -Fxq "$ZSH_PATH" /etc/shells; then
  echo "zsh is not listed in /etc/shells."
  if command -v sudo >/dev/null 2>&1; then
    echo "Adding zsh to /etc/shells with sudo..."
    echo "$ZSH_PATH" | sudo tee -a /etc/shells > /dev/null
  else
    echo "sudo is not available. Attempting to add zsh to /etc/shells directly..."
    echo "$ZSH_PATH" | tee -a /etc/shells >/dev/null
  fi
fi

# Set zsh as the default shell
echo "Setting zsh as the default shell..."
chsh -s "$ZSH_PATH"
