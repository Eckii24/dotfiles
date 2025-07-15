function repo() {
  local cmd="cd"
  local repo_path="$REPO_PATH"
  local no_cache=false
  local cache_file="$HOME/.local/state/repo/repos.txt"
  local cache_dir="$HOME/.local/state/repo"
  
  # Parse parameters
  local args=()
  while [[ $# -gt 0 ]]; do
    case $1 in
      --repo-path)
        repo_path="$2"
        shift 2
        ;;
      --no-cache)
        no_cache=true
        shift
        ;;
      -*)
        echo "Unknown parameter: $1"
        return 1
        ;;
      *)
        args+=("$1")
        shift
        ;;
    esac
  done
  
  # Set command from first positional argument
  if [[ ${#args[@]} -gt 0 ]]; then
    cmd="${args[1]}"
  fi
  
  # Check if repo_path is set
  if [[ -z "$repo_path" ]]; then
    echo "Error: REPO_PATH is not set and --repo-path not provided."
    return 1
  fi
  
  # Handle --no-cache: remove cache file if it exists
  if [[ "$no_cache" == true ]] && [[ -f "$cache_file" ]]; then
    rm "$cache_file"
  fi
  
  # Check if cache file exists
  if [[ ! -f "$cache_file" ]]; then
    # Create folder structure
    mkdir -p "$cache_dir"
    
    # Run az repos list command and save to cache
    echo "Fetching repository list..."
    az repos list --organization $AZURE_DEVOPS_ORG_URL --project $AZURE_DEVOPS_DEFAULT_PROJECT --output tsv --query '[].{Name:name,SSHUrl:sshUrl}' > "$cache_file"
    
    if [[ $? -ne 0 ]]; then
      echo "Error: Failed to fetch repository list."
      return 1
    fi
  fi
  
  # Read repos.txt and invoke fzf
  local selected_repo
  selected_repo=$(cat "$cache_file" | fzf --with-nth=1 --delimiter=$'\t')
  
  if [[ -z "$selected_repo" ]]; then
    echo "No repository selected."
    return 1
  fi
  
  # Extract repo name and URL from selected line
  local repo_name=$(echo "$selected_repo" | cut -f1)
  local repo_url=$(echo "$selected_repo" | cut -f2)
  local repo_folder="$repo_path/$repo_name"
  
  # Check if folder exists in repo_path
  if [[ ! -d "$repo_folder" ]]; then
    echo "Cloning repository: $repo_name"
    git clone "$repo_url" "$repo_folder"
    
    if [[ $? -ne 0 ]]; then
      echo "Error: Failed to clone repository."
      return 1
    fi
  fi
  
  # Execute command if not "cd"
  if [[ "$cmd" == "cd" ]]; then
    cd "$repo_folder" || return 1
  else
    # Execute the command with remaining arguments in a subshell
    (
      cd "$repo_folder" || exit 1
      "$cmd" "${args[@]:2}"
    )
  fi
}
