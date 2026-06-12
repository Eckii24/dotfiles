if [[ "$TERMINAL_EMULATOR" != "JetBrains-JediTerm" && "$TERM_PROGRAM" != "vscode" && "$TERM" != tmux* && "$TERM" != screen* ]]; then
  tmux new -A -s TMUX
fi

