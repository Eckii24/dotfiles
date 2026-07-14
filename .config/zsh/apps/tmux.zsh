if [[ "$TERMINAL_EMULATOR" != "JetBrains-JediTerm" && "$TERM_PROGRAM" != "vscode" && "$TERM" != tmux* && "$TERM" != screen* && -z $HERDR_ENV ]]; then
  tmux new -A -s TMUX
fi

