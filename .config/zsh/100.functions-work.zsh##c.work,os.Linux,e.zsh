fzf-repo() {
  local cmd="$1" # The base command (e.g., cd or vim)
  local selected_dir

  # Run fd and fzf to select a directory
  selected_dir=$(fd -t d -d 1 . "~/Development/Repos" | fzf)

  if [[ -n "$selected_dir" ]]; then
    # If a directory is selected, execute the command
    $cmd "$selected_dir"
  else
    # Else execute the command in the current directory
    $cmd .
  fi
}

alias repo="fzf-repo"
