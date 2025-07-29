autoload -Uz compinit
compinit

# ZSH plugins for Linux (installed via git clones, not brew)
ZSH_PLUGINS_DIR="$HOME/.local/share/zsh-plugins"

# Load zsh-vi-mode (should be loaded first)
if [[ -f "$ZSH_PLUGINS_DIR/zsh-vi-mode/zsh-vi-mode.plugin.zsh" ]]; then
    source "$ZSH_PLUGINS_DIR/zsh-vi-mode/zsh-vi-mode.plugin.zsh"
    zvm_after_init_commands+=('source <(fzf --zsh)')
fi

# Load zsh-you-should-use
if [[ -f "$ZSH_PLUGINS_DIR/zsh-you-should-use/you-should-use.plugin.zsh" ]]; then
    source "$ZSH_PLUGINS_DIR/zsh-you-should-use/you-should-use.plugin.zsh"
fi

# Load zsh-autosuggestions
if [[ -f "$ZSH_PLUGINS_DIR/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
    source "$ZSH_PLUGINS_DIR/zsh-autosuggestions/zsh-autosuggestions.zsh"
fi

# Load zsh-syntax-highlighting (should be last)
if [[ -f "$ZSH_PLUGINS_DIR/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]]; then
    source "$ZSH_PLUGINS_DIR/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
fi