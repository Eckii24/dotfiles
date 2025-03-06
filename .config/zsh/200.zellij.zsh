# Only start zellij if we are not in JetBrains IDEs
if [[ "$TERMINAL_EMULATOR" != *"JetBrains-JediTerm"* ]]; then
  # Auto attaching leads to issues on the linux VM.
  if [[ "$OSTYPE" == "darwin"* ]]; then
    export ZELLIJ_AUTO_ATTACH="true"
  fi

  eval "$(zellij setup --generate-auto-start zsh)"
fi

alias zellijc="zellij --layout custom"
