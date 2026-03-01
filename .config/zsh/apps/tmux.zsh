if [[ "$TERMINAL_EMULATOR" != "JetBrains-JediTerm" && "$TERM_PROGRAM" != "vscode" ]]; then
  if [ -z "$TMUX" ]; then
    tmux new -A -s TMUX
  fi
fi

