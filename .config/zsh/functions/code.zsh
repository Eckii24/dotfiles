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

  # Helper function to check if external command exists (not function/alias)
  local external_code_exists=false
  local external_code_insiders_exists=false
  
  # Check for external code command by looking in PATH directories
  local path_dir
  for path_dir in ${(s/:/)PATH}; do
    if [[ -x "$path_dir/code" ]]; then
      external_code_exists=true
      break
    fi
  done
  
  # Check for external code-insiders command
  for path_dir in ${(s/:/)PATH}; do
    if [[ -x "$path_dir/code-insiders" ]]; then
      external_code_insiders_exists=true
      break
    fi
  done

  # If force_insiders is true, directly try code-insiders
  if [[ "$force_insiders" == true ]]; then
    if [[ "$external_code_insiders_exists" == true ]]; then
      command code-insiders "${args[@]}"
    else
      echo "Error: code-insiders is not available" >&2
      return 1
    fi
  else
    # Check if code is available first
    if [[ "$external_code_exists" == true ]]; then
      command code "${args[@]}"
    elif [[ "$external_code_insiders_exists" == true ]]; then
      command code-insiders "${args[@]}"
    else
      echo "Error: Neither code nor code-insiders is available" >&2
      return 1
    fi
  fi
}