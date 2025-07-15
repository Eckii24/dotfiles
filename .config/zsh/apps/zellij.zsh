
# Start zellij if in an SSH session or running inside WSL
if [[ -n "$SSH_CONNECTION" || -n "$WSL_DISTRO_NAME" ]]; then
  export ZELLIJ_AUTO_ATTACH=true
  eval "$(zellij setup --generate-auto-start zsh)"
fi

alias zellijc="zellij --layout custom"

