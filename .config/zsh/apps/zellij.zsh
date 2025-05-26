# Only start zellij if we are in an SSH session
if [[ -n "$SSH_CONNECTION" ]]; then
  eval "$(zellij setup --generate-auto-start zsh)"
fi

alias zellijc="zellij --layout custom"

