
# Start zellij unless the terminal is JetBrains-JediTerm or VSCode
if [[ "$TERMINAL_EMULATOR" != "JetBrains-JediTerm" && "$TERM_PROGRAM" != "vscode" ]]; then
  # export ZELLIJ_AUTO_ATTACH=true
  eval "$(zellij setup --generate-auto-start zsh)"
fi


alias zellijc="zellij --layout custom"

