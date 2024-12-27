autoload -Uz compinit
compinit

# function
backup-proxmox() {
    # Source and destination paths
    SOURCE_PATH="proxmox:/var/lib/vz/dump"
    DESTINATION_PATH="/Users/matthiaseck/Library/Mobile Documents/com~apple~CloudDocs/Backups/proxmox"

    # Copy files starting with "vzdump-lxc-102" using scp
    scp "$SOURCE_PATH"/vzdump-lxc-102\* "$DESTINATION_PATH" && \

    # If scp command is successful, delete older files from the destination path
    find "$DESTINATION_PATH" -maxdepth 1 -type f -name 'vzdump-lxc-102*' -mtime +7 -exec rm {} \;
}

# Used plugins via brew
source $(brew --prefix)/opt/zsh-vi-mode/share/zsh-vi-mode/zsh-vi-mode.plugin.zsh
zvm_after_init_commands+=('source <(fzf --zsh)')

source $(brew --prefix)/share/zsh-you-should-use/you-should-use.plugin.zsh
source $(brew --prefix)/share/zsh-autosuggestions/zsh-autosuggestions.zsh
source $(brew --prefix)/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh # should be last

# Used manual plugins
source "$HOME/.config/zsh/git.plugin.zsh"

# aliases
alias icloud='cd ~/Library/Mobile\ Documents/com~apple~CloudDocs'

alias prev='fzf --preview "bat --style=numbers --color=always --line-range :500 {}"'

alias cd='z'
alias cdi='zi'
alias cat='bat'
alias lg='lazygit'
alias diff='delta -n -s'

alias ls='eza --color=always --icons=always'
alias ll='ls --long --git'
alias la='ls --long --all --git'

# docker aliases
alias mitmweb='docker run -it --rm -v ~/.mitmproxy:/home/mitmproxy/.mitmproxy -p 8080:8080 -p 127.0.0.1:8081:8081 mitmproxy/mitmproxy mitmweb --web-host 0.0.0.0'

# PATH
if [[ ! ":$PATH:" =~ ":$(brew --prefix)/bin:" ]]; then
  export PATH="$PATH:$(brew --prefix)/bin"
fi

# Setup fzf
source <(fzf --zsh)

export FZF_DEFAULT_COMMAND="fd --hidden --strip-cwd-prefix --exclude .git"
export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
export FZF_ALT_C_COMMAND="fd --type=d --hidden --strip-cwd-prefix --exclude .git"

# Use fd (https://github.com/sharkdp/fd) for listing path candidates.
# - The first argument to the function ($1) is the base path to start traversal
# - See the source code (completion.{bash,zsh}) for the details.
_fzf_compgen_path() {
  fd --hidden --exclude .git . "$1"
}

# Use fd to generate the list for directory completion
_fzf_compgen_dir() {
  fd --type=d --hidden --exclude .git . "$1"
}

dir_preview="eza --tree --color=always {} | head -200"
show_file_or_dir_preview="if [ -d {} ]; then $dir_preview; else bat -n --color=always --line-range :500 {}; fi"

export FZF_CTRL_T_OPTS="--preview '$show_file_or_dir_preview'"
export FZF_ALT_C_OPTS="--preview '$dir_preview'"

# Advanced customization of fzf options via _fzf_comprun function
# - The first argument to the function is the name of the command.
# - You should make sure to pass the rest of the arguments to fzf.
_fzf_comprun() {
  local command=$1
  shift

  case "$command" in
    cd)           fzf --preview "$dir_preview" "$@" ;;
    export|unset) fzf --preview "eval 'echo \${}'"         "$@" ;;
    ssh)          fzf --preview 'dig {}'                   "$@" ;;
    *)            fzf --preview "$show_file_or_dir_preview" "$@" ;;
  esac
}

eval "$(zoxide init zsh)"

if [ "$TERM_PROGRAM" != "Apple_Terminal" ]; then
    eval "$(oh-my-posh init zsh --config ~/.config/oh-my-posh/theme.json)"
fi
