function repo() {
  local command_to_run=""
  local repo_path="$REPO_PATH"
  local no_cache=false
  local cache_file="$HOME/.local/state/repo/repos.txt"
  local cache_dir="$HOME/.local/state/repo"
  local mode="interactive"  # modes: interactive, list, search, name
  local search_query=""
  local repo_name_arg=""

  # Parse parameters
  local args=()
  local pre_query=""
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
      -c|--command)
        command_to_run="$2"
        shift 2
        ;;
      --list)
        mode="list"
        shift
        ;;
      --search)
        mode="search"
        search_query="$2"
        shift 2
        ;;
      --name)
        mode="name"
        repo_name_arg="$2"
        shift 2
        ;;
      -h|--help)
        cat <<'EOF'
repo - Azure DevOps repository manager

USAGE
  repo [OPTIONS] [QUERY]

DESCRIPTION
  Manages Azure DevOps repositories: lists, searches, clones (if needed),
  and navigates into them. Repositories are cached locally after the first
  fetch.

  By default (interactive mode) an fzf picker is opened. The non-interactive
  flags (--list, --search, --name) bypass fzf and are suitable for scripted
  or LLM-driven use.

OPTIONS
  -h, --help
      Show this help text and exit.

  --list
      Print all repository names, one per line. No fzf. No REPO_PATH needed.
      Use this to discover available repositories before calling --name.

  --search <query>
      Print repository names that contain <query> (case-insensitive), one per
      line. No fzf. No REPO_PATH needed.
      Use this to narrow down candidates before calling --name.

  --name <name>
      Select a repository by its exact name (case-insensitive) and cd into it,
      cloning first if the local folder does not exist yet. No fzf required.
      Combine with --command to run a shell command inside the repo instead of
      changing directory.

  -c, --command <cmd>
      Shell command to run inside the repository folder. When given, the
      function runs <cmd> in a subshell instead of cd-ing into the repo.
      Compatible with --name and interactive mode.

  --repo-path <path>
      Override the base directory where repositories are cloned.
      Defaults to the REPO_PATH environment variable.

  --no-cache
      Delete the local repository cache before running, forcing a fresh fetch
      from Azure DevOps.

  [QUERY]
      Optional positional argument. In interactive mode this pre-fills the fzf
      search box.

ENVIRONMENT
  REPO_PATH                    Base directory for cloned repositories.
  AZURE_DEVOPS_ORG_URL         Azure DevOps organisation URL.
  AZURE_DEVOPS_DEFAULT_PROJECT Default Azure DevOps project name.

EXAMPLES
  # Interactive picker
  repo
  repo my-service

  # List / search (no fzf, safe for scripts and LLMs)
  repo --list
  repo --search payments

  # Navigate to a repo by name (clones if necessary)
  repo --name my-service-api

  # Run a command inside a repo without cd-ing
  repo --name my-service-api --command "git status"
  repo --name my-service-api -c "git log --oneline -10"

  # Force cache refresh then open picker
  repo --no-cache

LLM USAGE GUIDE
  LLMs cannot use the interactive fzf picker. Use this workflow instead:

  1. Discover repositories by filter keyword:
       repo --search <keyword>
     or get the whole list of all known repositories (costly):
       repo --list

  2. Pick the exact name from the output.

  3. Navigate or run a command:
       repo --name <exact-name>
       repo --name <exact-name> --command "<shell-cmd>"

  If REPO_PATH is not set, pass --repo-path <dir> explicitly.
  Re-run with --no-cache if the repository list may be stale.
EOF
        return 0
        ;;
      -* )
        echo "Unknown parameter: $1"
        return 1
        ;;
      * )
        args+=("$1")
        shift
        ;;
    esac
  done

  # Set pre_query from first positional argument (interactive mode only)
  if [[ ${#args[@]} -eq 1 ]]; then
    pre_query="${args[1]}"
  fi

  # Check if repo_path is set (not needed for list/search)
  if [[ "$mode" != "list" && "$mode" != "search" && -z "$repo_path" ]]; then
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

  # -- Non-interactive modes --

  # --list: print all repository names
  if [[ "$mode" == "list" ]]; then
    cut -f1 "$cache_file"
    return 0
  fi

  # --search: print repository names matching query (case-insensitive)
  if [[ "$mode" == "search" ]]; then
    if [[ -z "$search_query" ]]; then
      echo "Error: --search requires a query argument."
      return 1
    fi
    cut -f1 "$cache_file" | grep -i "$search_query"
    return 0
  fi

  # --name: select repository by exact name (case-insensitive)
  if [[ "$mode" == "name" ]]; then
    if [[ -z "$repo_name_arg" ]]; then
      echo "Error: --name requires a repository name argument."
      return 1
    fi
    if [[ -z "$repo_path" ]]; then
      echo "Error: REPO_PATH is not set and --repo-path not provided."
      return 1
    fi
    local matched_line
    matched_line=$(grep -i "^${repo_name_arg}"$'\t' "$cache_file" | head -n1)
    if [[ -z "$matched_line" ]]; then
      echo "Error: No repository found matching name '${repo_name_arg}'."
      return 1
    fi
    local repo_name=$(echo "$matched_line" | cut -f1)
    local repo_url=$(echo "$matched_line" | cut -f2)
    local repo_folder="$repo_path/$repo_name"

    if [[ ! -d "$repo_folder" ]]; then
      echo "Cloning repository: $repo_name"
      git clone "$repo_url" "$repo_folder"
      if [[ $? -ne 0 ]]; then
        echo "Error: Failed to clone repository."
        return 1
      fi
    fi

    if [[ -n "$command_to_run" ]]; then
      (
        cd "$repo_folder" || exit 1
        eval "$command_to_run"
      )
    else
      cd "$repo_folder" || return 1
    fi
    return 0
  fi

  # -- Interactive mode (default) --

  local selected_repo
  if [[ -n "$pre_query" ]]; then
    selected_repo=$(cat "$cache_file" | fzf --with-nth=1 --delimiter=$'\t' --query="$pre_query")
  else
    selected_repo=$(cat "$cache_file" | fzf --with-nth=1 --delimiter=$'\t')
  fi

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
  if [[ -n "$command_to_run" ]]; then
    (
      cd "$repo_folder" || exit 1
      eval "$command_to_run"
    )
  else
    cd "$repo_folder" || return 1
  fi
}
