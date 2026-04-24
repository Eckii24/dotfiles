summarize-latest-vtt() {
  local -r FUNCTION_NAME="summarize-latest-vtt"

  local model=""
  local delete_after_success=false
  local role="meeting"
  local downloads_dir="$HOME/Downloads"
  local glossary_file="$WIKI_HOME/resources/p0-glossar.md"

  _error() { echo "[$FUNCTION_NAME] ERROR: $1" >&2; }
  _warn() { echo "[$FUNCTION_NAME] WARN: $1" >&2; }
  _info() { echo "[$FUNCTION_NAME] INFO: $1" >&2; }

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model|-m)
        if [[ -z "$2" ]]; then
          _error "Missing value for $1"
          return 1
        fi
        model="$2"
        shift 2
        ;;
      --delete)
        delete_after_success=true
        shift
        ;;
      --help|-h)
        cat << 'EOF'
Usage: summarize-latest-vtt [options]

Find the newest .vtt file in ~/Downloads, summarize it via the same meeting
setup (glossary + aichat role), print the summary, and copy it to the clipboard.

Options:
  -m, --model MODEL   Pass MODEL to aichat (-m)
      --delete        Delete the processed VTT file after a successful summary
  -h, --help          Show this help

Dependencies: aichat
EOF
        return 0
        ;;
      -* )
        _error "Unknown option: $1"
        return 1
        ;;
      *)
        _error "Unexpected argument: $1"
        return 1
        ;;
    esac
  done

  if [[ ! -d "$downloads_dir" ]]; then
    _error "Downloads directory not found: $downloads_dir"
    return 1
  fi

  if [[ ! -f "$glossary_file" ]]; then
    _error "Glossary file not found at $glossary_file"
    return 1
  fi

  if ! command -v aichat >/dev/null 2>&1; then
    _error "Missing dependency: aichat"
    return 1
  fi

  local -a newest_vtt_matches=("$downloads_dir"/*.vtt(N.om[1]))
  local newest_vtt="${newest_vtt_matches[1]}"

  if [[ -z "$newest_vtt" ]]; then
    _error "No .vtt files found in $downloads_dir"
    return 1
  fi

  _info "Using VTT file: $newest_vtt"

  local glossary_content
  glossary_content=$(<"$glossary_file")

  local aichat_args=("-r" "$role")
  [[ -n "$model" ]] && aichat_args+=("-m" "$model")

  local summary
  if ! summary=$({
    printf '%s\n\n' "$glossary_content"
    cat "$newest_vtt"
  } | aichat "${aichat_args[@]}"); then
    _error "Failed to generate summary"
    return 1
  fi

  if [[ -z "$summary" ]]; then
    _error "aichat returned no summary"
    return 1
  fi

  print -r -- "$summary"

  if command -v pbcopy >/dev/null 2>&1; then
    printf '%s\n' "$summary" | pbcopy
  else
    _warn "pbcopy not found — output not copied to clipboard"
  fi

  if [[ "$delete_after_success" == true ]]; then
    if rm -f -- "$newest_vtt"; then
      _info "Deleted processed VTT file: $newest_vtt"
    else
      _error "Failed to delete processed VTT file: $newest_vtt"
      return 1
    fi
  fi
}
