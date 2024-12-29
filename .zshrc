for config_file in $HOME/.config/zsh/*.zsh; do
  # Skip YADM alternate files, where no symlink is created
  if [[ "$config_file" == *"##"* || "$config_file" == *"$"* ]]; then
    continue
  fi

  source "$config_file"
done
