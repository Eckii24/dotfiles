function code() {
  local force_insiders=false
  local args=()

  # Parse arguments to check for -I or --insiders flag
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      -I|--insiders)
        force_insiders=true
        shift
        ;;
      *)
        args+=("$1")
        shift
        ;;
    esac
  done

  # If force_insiders is true, directly try code-insiders
  if [[ "$force_insiders" == true ]]; then
    command code-insiders "${args[@]}"
  else
    # Try to find external code command (not the function)
    if command -v code >/dev/null 2>&1; then
      command code "${args[@]}"
    else
      command code-insiders "${args[@]}"
    fi
  fi
}