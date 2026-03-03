function meeting() {
  local role="meeting"
  local model=""
  local interactive=""
  local glossary_file="$HOME/Development/Repos/Notes/resources/p0-glossar.md"

  # Parse command line arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      -r|--role)
        role="$2"
        shift 2
        ;;
      -m|--model)
        model="$2"
        shift 2
        ;;
      -i|--interactive)
        interactive="true"
        shift
        ;;
      *)
        echo "Unknown option: $1"
        echo "Usage: meeting [-r|--role <role>] [-m|--model <model>] [-i|--interactive]"
        return 1
        ;;
    esac
  done

  # Read glossary content
  if [[ ! -f "$glossary_file" ]]; then
    echo "Error: Glossary file not found at $glossary_file"
    return 1
  fi
  local glossary_content
  glossary_content=$(cat "$glossary_file")

  # Build audiobot args
  local audiobot_args=()
  [[ -n "$interactive" ]] && audiobot_args+=("-i")

  # Use a temp file to capture audiobot stdout while keeping stdin/stderr connected to the terminal.
  # This ensures: progress/timer visible (stderr), Ctrl+C works to stop recording (stdin),
  # and only the final transcript (stdout) is captured for aichat.
  local temp_output
  temp_output=$(mktemp)
  # Ensure temp file is removed on function exit or if interrupted (INT, TERM) or on shell exit (EXIT).
  trap 'rm -f "$temp_output"' EXIT INT TERM


  audiobot start "${audiobot_args[@]}" > "$temp_output"

  if [[ $? -ne 0 ]]; then
    echo "Error: audiobot start failed"
    return 1
  fi

  local audiobot_output
  audiobot_output=$(cat "$temp_output")

  if [[ -z "$audiobot_output" ]]; then
    echo "Error: audiobot produced no transcript output"
    return 1
  fi

  # Build aichat args
  local aichat_args=("-r" "$role")
  [[ -n "$model" ]] && aichat_args+=("-m" "$model")

  # Pass glossary + transcript to aichat; capture output so we can both print it and copy to clipboard.
  local aichat_output
  aichat_output=$(printf '%s\n\n%s\n' "$glossary_content" "$audiobot_output" | aichat "${aichat_args[@]}")

  # Print the aichat result to stdout (so it still appears in terminal)
  printf '%s\n' "$aichat_output"

  # Copy the result to macOS clipboard
  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s\n' "$aichat_output" | pbcopy
  else
    echo "Warning: pbcopy not found — output not copied to clipboard" >&2
  fi
}
