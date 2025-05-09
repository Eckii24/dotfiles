function repo() {
  local cmd="${1:-cd}" # Default to "cd" if no command is provided
  local selected_dir
  local repo_url

  # Check if REPO_PATH is set
  if [[ -z "$REPO_PATH" ]]; then
    echo "Error: REPO_PATH is not set."
    return 1
  fi

  # If the command is "clone", execute the az-repo logic to select a repository
  if [[ "$cmd" == "clone" ]]; then
    repo_url=$(az repos list --output tsv --query '[].{SSHUrl:sshUrl}' | fzf)
    if [[ -n "$repo_url" ]]; then
      # Call clone-repo function directly with the selected URL
      git clone "$repo_url" "$REPO_PATH/$(basename "$repo_url")"

      # Change into the cloned directory
      cd "$REPO_PATH/$(basename "$repo_url")" || return
    else
      echo "No repository selected."
    fi
  else
    # Run fd and fzf to select a directory
    selected_dir=$(fd -t d -d 1 . "$REPO_PATH" | fzf)

    if [[ -n "$selected_dir" ]]; then
      # If the command is cd, we don't want to execute cd twice
      if [[ "$cmd" == "cd" ]]; then
        cd "$selected_dir" || return
      else
        # Execute the command in the selected directory
        (cd "$selected_dir" && "$cmd" "${@:2}")
      fi
    else
      echo "No directory selected."
    fi
  fi
}
