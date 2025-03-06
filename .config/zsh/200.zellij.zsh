# Only start zellij if we are not in JetBrains IDEs
if [[ "$TERMINAL_EMULATOR" != *"JetBrains-JediTerm"* ]]; then
  eval "$(zellij setup --generate-auto-start zsh)"
fi

alias zellijc="zellij --layout custom"
