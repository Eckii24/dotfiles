function source-folder() {
  local folder=""

  # Parse arguments
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --folder|-f)
        folder="$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1" >&2
        return 1
        ;;
    esac
  done

  # Check if folder is provided
  if [[ -z "$folder" ]]; then
    echo "Error: --folder or -f argument is required." >&2
    return 1
  fi

  # Check if folder exists
  if [[ ! -d "$folder" ]]; then
    echo "Error: Folder '$folder' does not exist." >&2
    return 1
  fi

  # Source all .zsh files in the folder
  for file in "$folder"/*.zsh; do
    if [[ "$config_file" == *"##"* || "$config_file" == *"$"* ]]; then
      continue
    fi

    if [[ -f "$file" ]]; then
      source "$file"
    fi
  done
}

source-folder --folder "$HOME/.config/zsh"
