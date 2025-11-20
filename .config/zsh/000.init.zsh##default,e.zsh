fpath=($fpath $HOME/.config/zsh/completions/)
autoload -Uz compinit
compinit
zstyle ':completion:*' matcher-list 'm:{a-z}={A-Za-z}'

# Source brew director, if not already done
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

# Used plugins via brew
source $(brew --prefix)/opt/zsh-vi-mode/share/zsh-vi-mode/zsh-vi-mode.plugin.zsh
zvm_after_init_commands+=('source <(fzf --zsh)')

source $(brew --prefix)/share/zsh-you-should-use/you-should-use.plugin.zsh
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh
source $(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh # should be last
