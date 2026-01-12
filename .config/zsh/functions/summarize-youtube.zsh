summarize-youtube() {
  local -r FUNCTION_NAME="summarize-youtube"

  local output_file=""
  local model=""
  local youtube_url=""
  local verbose=false

  _log_info() { echo "[$FUNCTION_NAME] INFO: $1" >&2; }
  _log_step() { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] STEP: $1" >&2; }
  _log_debug() { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] DEBUG: $1" >&2; }
  _error() { echo "[$FUNCTION_NAME] ERROR: $1" >&2; }

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --output|-o)
        output_file="$2"
        shift 2
        ;;
      --model|-m)
        model="$2"
        shift 2
        ;;
      --verbose|-v)
        verbose=true
        shift
        ;;
      --help|-h)
        cat << 'EOF'
Usage: summarize-youtube [options] <youtube-url>

Summarize a YouTube video by fetching its English transcript via yt-dlp and
sending it to aichat.

Options:
  -o, --output FILE   Write summary to FILE (default: stdout)
  -m, --model MODEL   Pass MODEL to aichat (-m)
  -v, --verbose       Enable verbose logs
  -h, --help          Show this help

Dependencies: yt-dlp, aichat
EOF
        return 0
        ;;
      -* )
        _error "Unknown option: $1"
        return 1
        ;;
      *)
        youtube_url="$1"
        shift
        ;;
    esac
  done

  if [[ -z "$youtube_url" ]]; then
    _error "Usage: summarize-youtube [options] <youtube-url>"
    return 1
  fi

  _log_info "Processing: $youtube_url"

  for cmd in yt-dlp aichat; do
    command -v "$cmd" >/dev/null || { _error "Missing dependency: $cmd"; return 1; }
  done

  local prompt
  prompt=$'You are an AI assistant tasked with summarizing a YouTube video based on its transcript.\n\nFollow these guidelines:\n- Write a concise, high-signal summary of what the video is about.\n- Capture the main thesis, key points, and any practical takeaways.\n- Use clear structure with headings and bullet points where appropriate.\n- If the transcript is noisy or incomplete, state assumptions and avoid hallucinations.\n\nOutput format:\n## Summary\n\n## Key Points\n\n## Takeaways\n'

  local tmp_dir
  tmp_dir="$(mktemp -d)" || { _error "Failed to create temp dir"; return 1; }
  _log_step "Using temp dir: $tmp_dir"

  cleanup() {
    command rm -rf "$tmp_dir"
  }
  trap cleanup EXIT

  local outtmpl
  outtmpl="$tmp_dir/subtitle"

  _log_step "Downloading English auto-subs (yt-dlp)"
  _log_debug "Running: yt-dlp --write-auto-subs --sub-langs en.* --sub-format vtt --skip-download -o $outtmpl <url>"
  yt-dlp --quiet --no-warnings \
    --write-auto-subs --sub-langs "en.*" --sub-format "vtt" \
    --skip-download -o "$outtmpl" \
    "$youtube_url" 2>/dev/null || { _error "yt-dlp failed"; return 1; }

  local transcript_file
  transcript_file="$(find "$tmp_dir" -maxdepth 1 -type f -name "*.vtt" -print -quit 2>/dev/null)"
  if [[ -z "$transcript_file" ]]; then
    _error "No English transcript found (expected .vtt)."
    return 1
  fi
  _log_step "Transcript file: $transcript_file"

  _log_step "Summarizing transcript with aichat"
  if [[ -n "$model" ]]; then
    _log_debug "Running: aichat -m $model <transcript>"
  else
    _log_debug "Running: aichat <transcript>"
  fi

  local summary
  if [[ -n "$model" ]]; then
    summary=$(aichat -m "$model" "$prompt" < "$transcript_file" 2>/dev/null)
  else
    summary=$(aichat "$prompt" < "$transcript_file" 2>/dev/null)
  fi

  if [[ -z "$summary" ]]; then
    _error "Failed to generate summary"
    return 1
  fi

  if [[ -n "$output_file" ]]; then
    _log_step "Writing summary to: $output_file"
    print -r -- "$summary" > "$output_file"
  else
    print -r -- "$summary"
  fi
}
