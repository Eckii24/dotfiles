#!/usr/bin/env zsh
# Karakeep Archived Videos Summarizer
# Fetch archived YouTube videos from Karakeep, transcribe them, and produce
# a rough 3-5 checkpoint summary for each, then print a combined overview.

summarize-karakeep-archived-videos() {
    local -r FUNCTION_NAME="summarize-karakeep-archived-videos"

    # Logging helpers
    _log_info() { echo "[$FUNCTION_NAME] INFO: $1" >&2; }
    _log_step() { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] STEP: $1" >&2; }
    _log_debug() { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] DEBUG: $1" >&2; }
    _error() { echo "[$FUNCTION_NAME] ERROR: $1" >&2; }

    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: summarize-karakeep-archived-videos [options]

Fetch archived YouTube videos from Karakeep, get their transcripts, and
produce a rough 3-5 checkpoint summary for each video. Prints a combined
overview of all videos with their names and summaries.

Options:
  -d, --days N        Only include videos from the last N days (default: 7)
  --token TOKEN       Karakeep API token (default: $KARAKEEP_TOKEN)
  -m, --model MODEL   AI model to use (passed to aichat)
  -o, --output FILE   Write combined summary to FILE (default: stdout)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq, yt-dlp, aichat
EOF
    }

    # Defaults
    local KARAKEEP_TOKEN_VAL="${KARAKEEP_TOKEN:-}"
    local KARAKEEP_HOST="${KARAKEEP_HOST:-}"
    local model=""
    local days=7
    local output_file=""
    local verbose=false

    # Parse CLI arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -d|--days)    days="$2";              shift 2 ;;
            --token)      KARAKEEP_TOKEN_VAL="$2"; shift 2 ;;
            -m|--model)   model="$2";              shift 2 ;;
            -o|--output)  output_file="$2";        shift 2 ;;
            -v|--verbose) verbose=true;            shift   ;;
            -h|--help)    _show_help;              return 0 ;;
            *) _error "Unknown option: $1"; return 1 ;;
        esac
    done

    # Validate arguments
    [[ ! "$days" =~ ^[0-9]+$ || "$days" -lt 1 ]] && {
        _error "Days must be a positive integer (got: '$days')"
        return 1
    }
    [[ -z "$KARAKEEP_TOKEN_VAL" ]] && {
        _error "Karakeep token not set. Use --token or KARAKEEP_TOKEN env"
        return 1
    }
    [[ -z "$KARAKEEP_HOST" ]] && {
        _error "Karakeep host not set. Use KARAKEEP_HOST env"
        return 1
    }

    # Check dependencies
    for cmd in curl jq yt-dlp aichat; do
        command -v "$cmd" >/dev/null || { _error "Missing dependency: $cmd"; return 1; }
    done

    # Compute cutoff timestamp (seconds since epoch) – supports GNU and BSD date
    local cutoff
    cutoff="$(date -d "$days days ago" +%s 2>/dev/null || date -v "-${days}d" +%s 2>/dev/null)" || {
        _error "Failed to compute cutoff date"
        return 1
    }
    _log_step "Cutoff: $days days ago (epoch $cutoff)"

    # Base64 decode – supports both GNU coreutils and macOS
    _b64decode() {
        base64 --decode 2>/dev/null || base64 -D 2>/dev/null
    }

    # ------------------------------------------------------------------ #
    # Fetch archived YouTube bookmarks from Karakeep                      #
    # ------------------------------------------------------------------ #
    _fetch_items() {
        _log_step "Querying Karakeep API for archived YouTube bookmarks"
        local search_query='(url:youtube.com or url:youtu.be) and is:archived'
        local encoded_query
        encoded_query="$(printf '%s' "$search_query" | jq -sRr @uri)"

        local resp
        resp="$(curl -sS \
            -H "Authorization: Bearer ${KARAKEEP_TOKEN_VAL}" \
            -H "Content-Type: application/json" \
            -X GET \
            "$KARAKEEP_HOST/api/v1/bookmarks/search?q=$encoded_query")" || {
            _error "Failed to query Karakeep API"
            return 1
        }

        # Strip ASCII control characters (0x00-0x1F) that can appear in
        # Karakeep API responses and would break jq's JSON parser.
        resp="$(printf '%s' "$resp" | tr -d '\000-\037')"

        if printf '%s' "$resp" | jq -e '.error' >/dev/null 2>&1; then
            _error "Karakeep API error: $(printf '%s' "$resp" | jq -r '.error')"
            return 1
        fi

        printf '%s' "$resp" | jq -r '.bookmarks[]? | @base64'
    }

    # ------------------------------------------------------------------ #
    # Summarize a single YouTube video with a 3-5 checkpoint prompt       #
    # ------------------------------------------------------------------ #
    _summarize_video() {
        local url="$1"

        local prompt
        prompt='You are summarizing a YouTube video transcript. Give a very rough summary using exactly 3 to 5 bullet point checkpoints. Each checkpoint must be a single concise sentence capturing a key moment or topic covered in the video. Output only the bullet points, nothing else.'

        local tmp_dir
        tmp_dir="$(mktemp -d)" || { _error "Failed to create temp dir"; return 1; }

        local outtmpl="$tmp_dir/subtitle"

        _log_debug "Downloading transcript for: $url"
        yt-dlp --quiet --no-warnings \
            --write-auto-subs --sub-langs "en" --sub-format "vtt" \
            --skip-download -o "$outtmpl" \
            "$url" 2>/dev/null

        local transcript_file
        transcript_file="$(find "$tmp_dir" -maxdepth 1 -type f -name "*.vtt" -print -quit 2>/dev/null)"

        if [[ -z "$transcript_file" ]]; then
            _log_debug "No English transcript found, trying German (de)"
            yt-dlp --quiet --no-warnings \
                --write-auto-subs --sub-langs "de" --sub-format "vtt" \
                --skip-download -o "$outtmpl" \
                "$url" 2>/dev/null
            transcript_file="$(find "$tmp_dir" -maxdepth 1 -type f -name "*.vtt" -print -quit 2>/dev/null)"
        fi

        if [[ -z "$transcript_file" ]]; then
            rm -rf "$tmp_dir"
            _error "No transcript found (tried en, de) for: $url"
            return 1
        fi

        local summary
        if [[ -n "$model" ]]; then
            summary="$(aichat -m "$model" "$prompt" < "$transcript_file" 2>/dev/null)"
        else
            summary="$(aichat "$prompt" < "$transcript_file" 2>/dev/null)"
        fi

        rm -rf "$tmp_dir"

        if [[ -z "$summary" ]]; then
            _error "aichat returned no summary for: $url"
            return 1
        fi

        printf '%s' "$summary"
    }

    # Build a markdown section for a single video entry
    _video_section() {
        local vtitle="$1" vurl="$2" vsummary="$3"
        printf '## %s\n**URL:** %s\n\n%s\n\n---\n\n' "$vtitle" "$vurl" "$vsummary"
    }

    # ------------------------------------------------------------------ #
    # Main                                                                 #
    # ------------------------------------------------------------------ #
    local bookmarks
    bookmarks="$(_fetch_items)" || return 1

    if [[ -z "$bookmarks" ]]; then
        _log_info "No archived YouTube videos found in Karakeep."
        return 0
    fi

    local combined_output=""
    local total=0 success=0 failed=0 skipped=0

    while IFS= read -r row; do
        [[ -z "$row" ]] && continue

        local _decoded
        if ! _decoded="$(printf '%s' "$row" | _b64decode)"; then
            _error "Failed to base64-decode bookmark row"
            (( failed++ ))
            continue
        fi

        local id url title created_at
        id="$(printf '%s' "$_decoded" | jq -r '.id')"
        url="$(printf '%s' "$_decoded" | jq -r '.content.url')"
        title="$(printf '%s' "$_decoded" | jq -r '.title // "Untitled"')"
        # Try createdAt first, then archivedAt as fallback
        created_at="$(printf '%s' "$_decoded" | jq -r '.createdAt // .archivedAt // empty')"

        if [[ -z "$url" || "$url" == "null" ]]; then
            _log_debug "Skipping bookmark '$title': no URL"
            (( skipped++ ))
            continue
        fi

        # ---- Date filtering ------------------------------------------ #
        if [[ -n "$created_at" ]]; then
            local bookmark_ts=""
            if [[ "$created_at" =~ ^[0-9]+$ ]]; then
                # Epoch milliseconds → seconds
                bookmark_ts=$(( created_at / 1000 ))
            else
                # ISO 8601 string (GNU date or BSD date)
                bookmark_ts="$(date -d "$created_at" +%s 2>/dev/null \
                    || date -j -f "%Y-%m-%dT%H:%M:%S" "${created_at%%.*}" +%s 2>/dev/null)"
            fi

            if [[ -n "$bookmark_ts" && "$bookmark_ts" -lt "$cutoff" ]]; then
                _log_step "Skipping '$title' (older than $days days)"
                (( skipped++ ))
                continue
            fi
        fi

        (( total++ ))
        _log_info "[$total] Processing: $title"
        _log_step "URL: $url"

        local summary
        if summary="$(_summarize_video "$url")"; then
            _log_step "Summary ready for: $title"
            combined_output+="$(_video_section "$title" "$url" "$summary")"
            (( success++ ))
        else
            combined_output+="$(_video_section "$title" "$url" "_Summary unavailable._")"
            (( failed++ ))
        fi
    done <<< "$bookmarks"

    if [[ $total -eq 0 ]]; then
        _log_info "No archived YouTube videos found within the last $days days."
        return 0
    fi

    # Build final document
    local header
    header="$(printf '# Archived YouTube Videos – Summary\n\n_Showing videos from the last **%s day(s)** · generated %s_\n\n' \
        "$days" "$(date '+%Y-%m-%d')")"

    local footer
    footer="$(printf '\n_Processed: %s video(s) · Success: %s · Failed: %s · Skipped (outside date range): %s_\n' \
        "$total" "$success" "$failed" "$skipped")"

    local final_output="${header}${combined_output}${footer}"

    if [[ -n "$output_file" ]]; then
        _log_step "Writing summary to: $output_file"
        printf '%s' "$final_output" > "$output_file"
        _log_info "Summary written to: $output_file"
    else
        printf '%s' "$final_output"
    fi
}
