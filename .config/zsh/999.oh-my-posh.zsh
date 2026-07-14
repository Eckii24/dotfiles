# Must be last

if [[ -n "$HERDR_ENV" ]]; then
  eval "$(oh-my-posh init zsh --config ~/.config/oh-my-posh/herdr.json)"
else
  eval "$(oh-my-posh init zsh --config ~/.config/oh-my-posh/theme.json)"
fi

