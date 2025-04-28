repo() {
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

run-repo(){
  if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <command> [args...]"
    exit 1
  fi

  COMMAND=("$@")

  for sub_dir in "$REPO_PATH/*"; do
    if [[ -d $sub_dir ]]; then
      echo "Running '${COMMAND[@]}' in $sub_dir"
      (cd "$sub_dir" && "${COMMAND[@]}")
      if [[ $? -ne 0 ]]; then
        echo "Command failed in $sub_dir"
      fi
    fi
  done
}

fab() {
  local model="gpt-4o"
  local params=()
  while (( "$#" )); do
    case "$1" in
      -m|--model)
        model="$2"
        shift 2
        ;;
      *)
        params+=("$1")
        shift
        ;;
    esac
  done

  local extra_params=()
  case "$model" in
    o1|o1-mini|o3|o3-mini|o4-mini)
      extra_params=(-t 1 -T 1)
      ;;
  esac
  fabric -m "$model" "${extra_params[@]}" "${params[@]}"
}

assessment() {
  local repo_url
  local model=""
  local output

  while [[ "$#" -gt 0 ]]; do
    case $1 in
      --repo | -r)
        repo_url="$2"
        shift 2
        ;;
      --model | -m)
        model="$2"
        shift 2
        ;;
      --output | -o)
        output="$2"
        shift 2
        ;;
      *)
        echo "Unknown parameter: $1"
        return 1
        ;;
    esac
  done

  if [[ -z "$repo_url" ]]; then
    echo "Error: --repo / -p parameter is required."
    return 1
  fi

  repomix --remote $repo_url

  # Pass the output to fabric -p check-assessment
  if [[ -n "$output" ]]; then
    (cat repomix-output.md | fab -m "$model" -p check_assessment -o "$output")
  else
    (cat repomix-output.md | fab -m "$model" -p check_assessment)
  fi
}


pr-text(){
  local model="gpt-4o" # Default value
  local output

  while [[ "$#" -gt 0 ]]; do
    case $1 in
      --model | -m)
        model="$2"
        shift 2
        ;;
      --output | -o)
        output="$2"
        shift 2
        ;;
      *)
        echo "Unknown parameter: $1"
        return 1
        ;;
    esac
  done

  local diff_output
  diff_output=$(git --no-pager diff $(git merge-base --fork-point master))

  if [[ -n "$output" ]]; then
    (echo "$diff_output" | fab -p write_pr -m "$model" -o "$output")
  else
    (echo "$diff_output" | fab -p write_pr -m "$model")
  fi
}
