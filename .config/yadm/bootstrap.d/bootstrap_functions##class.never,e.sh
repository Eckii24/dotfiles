# Function to add Homebrew to PATH
add_brew_to_path() {
  if [[  -x "/opt/homebrew/bin/brew"  ]]; then
    # Apple Silicon (ARM)
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[  -x "/usr/local/bin/brew"  ]]; then
    # Intel Mac
    eval "$(/usr/local/bin/brew shellenv)"
  elif [[  -x "/home/linuxbrew/.linuxbrew/bin/brew"  ]]; then
    # Linux
    eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
  fi
}

