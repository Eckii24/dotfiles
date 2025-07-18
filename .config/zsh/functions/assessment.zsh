function assessment() {
  local repo_url
  local model="azure:o4-mini"
  local output
  local branch
  local ignore

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
      --branch | -b)
        branch="$2"
        shift 2
        ;;
      --ignore | -i)
        ignore="$2"
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

  # Generate default output if not provided
  if [[ -z "$output" ]]; then
    output=$(echo "$repo_url" | sed -E 's|https://github.com/||; s|/|-|g; s|$|.md|' | tr '[:upper:]' '[:lower:]')
  fi

  # Construct the repomix command dynamically
  local repomix_cmd="repomix --remote \"$repo_url\""
  [[ -n "$branch" ]] && repomix_cmd+=" --remote-branch \"$branch\""
  [[ -n "$ignore" ]] && repomix_cmd+=" --ignore \"$ignore\""

  # Execute the repomix command
  eval "$repomix_cmd"

  # Pass the output to fabric -p check-assessment
  (cat repomix-output.md | aichat -m "$model" -r assessment -S > $output)
}
