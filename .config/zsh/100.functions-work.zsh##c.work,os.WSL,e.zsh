fzf-repo() {
  local cmd="$1" # The base command (e.g., cd or vim)
  local selected_dir

  # Run fd and fzf to select a directory
  selected_dir=$(fd -t d -d 1 . "/mnt/c/Users/vimateck/Development/Repos" | fzf)

  if [[ -n "$selected_dir" ]]; then
    # If a directory is selected, execute the command
    cd $selected_dir
    $cmd $selected_dir
  else
    # Else execute the command in the current directory
    $cmd .
  fi
}

clone-repo(){
  local repo_url="$1"
  git clone $repo_url "/mnt/c/Users/vimateck/Development/Repos/$(basename $repo_url)"
} 

run-repo(){
  if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <command> [args...]"
    exit 1
  fi

  COMMAND=("$@")

  for sub_dir in "/mnt/c/Users/vimateck/Development/Repos/*"; do
    if [[ -d $sub_dir ]]; then
      echo "Running '${COMMAND[@]}' in $sub_dir"
      (cd "$sub_dir" && "${COMMAND[@]}")
      if [[ $? -ne 0 ]]; then
        echo "Command failed in $sub_dir"
      fi
    fi
  done
}

alias repo="fzf-repo"
alias gcr="clone-repo"
