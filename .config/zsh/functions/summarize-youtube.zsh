summarize-youtube() {
  local output_file
  local model
  local youtube_url

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
      --help|-h)
        cat << 'EOF'
Usage: summarize-youtube [options] <youtube-url>

Summarize a YouTube video by fetching its English transcript via yt-dlp and
sending it to aichat.

Options:
  -o, --output FILE   Write summary to FILE (default: stdout)
  -m, --model MODEL   Pass MODEL to aichat (-m)
  -h, --help          Show this help

Dependencies: yt-dlp, aichat
EOF
        return 0
        ;;
      -* )
        echo "Unknown option: $1" >&2
        return 1
        ;;
      *)
        youtube_url="$1"
        shift
        ;;
    esac
  done

  if [[ -z "$youtube_url" ]]; then
    echo "Usage: summarize-youtube [options] <youtube-url>" >&2
    return 1
  fi

  for cmd in yt-dlp aichat; do
    command -v "$cmd" >/dev/null || { echo "Missing dependency: $cmd" >&2; return 1; }
  done

  local prompt
  prompt=$(cat <<'EOF'
You are an AI assistant tasked with summarizing a YouTube video based on its transcript.

Follow these guidelines:
- Write a concise, high-signal summary of what the video is about.
- Capture the main thesis, key points, and any practical takeaways.
- Use clear structure with headings and bullet points where appropriate.
- If the transcript is noisy or incomplete, state assumptions and avoid hallucinations.

Output format:
## Summary

## Key Points

## Takeaways
EOF
  )

  local -a aichat_args
  aichat_args=()
  [[ -n "$model" ]] && aichat_args+=( -m "$model" )

  local tmp_dir
  tmp_dir="$(mktemp -d)" || { echo "Error: failed to create temp dir" >&2; return 1; }

  local cleanup
  cleanup() {
    command rm -rf "$tmp_dir"
  }
  trap cleanup EXIT

  local outtmpl
  outtmpl="$tmp_dir/subtitle"

  yt-dlp --quiet --no-warnings \
    --write-auto-subs --sub-langs "en.*" --sub-format "vtt" \
    --skip-download -o "$outtmpl" \
    "$youtube_url" 2>/dev/null || { echo "Error: yt-dlp failed" >&2; return 1; }

  local transcript_file
  transcript_file="$(find "$tmp_dir" -maxdepth 1 -type f -name "*.vtt" -print -quit 2>/dev/null)"
  if [[ -z "$transcript_file" ]]; then
    echo "Error: no English transcript found (expected .vtt)." >&2
    return 1
  fi

  local summary
  summary=$(aichat "${aichat_args[@]}" "$prompt" < "$transcript_file" 2>/dev/null)

  if [[ -z "$summary" ]]; then
    echo "Error: failed to fetch transcript or generate summary." >&2
    return 1
  fi

  if [[ -n "$output_file" ]]; then
    print -r -- "$summary" > "$output_file"
  else
    print -r -- "$summary"
  fi
}
