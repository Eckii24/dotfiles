if [[ "$TERMINAL_EMULATOR" != "JetBrains-JediTerm" && "$TERM_PROGRAM" != "vscode" && -z "$SSH_CONNECTION" && -z "$SSH_CLIENT" ]]; then
  if [ -z "$TMUX" ]; then
    tmux new -A -s TMUX
  fi
fi

