#!/usr/bin/env bash
# Karakeep Bookmark Summarizer
# Summarizes Karakeep bookmarks tagged with SUMMARIZE and saves them to Vimwiki

summarize-karakeep-bookmarks() {
    local -r FUNCTION_NAME="summarize-karakeep-bookmarks"
    
    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: summarize-karakeep-bookmarks [options]

Fetch bookmarks with tag SUMMARIZE from Karakeep, generate summaries, and save to Vimwiki.

Options:
  --token TOKEN       Karakeep API token (default: $KARAKEEP_TOKEN)
  --vimwiki DIR       Vimwiki home directory (default: $VIMWIKI_HOME)
  -m, --model MODEL   AI model to use for summaries (passed to aichat)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq, yt-dlp, aichat
EOF
    }
    
    # Defaults from env
    local KARAKEEP_TOKEN_VAL="${KARAKEEP_TOKEN:-}"
    local KARAKEEP_HOST="${KARAKEEP_HOST:-}"
    local VIMWIKI_DIR="${VIMWIKI_HOME:-}"
    local model=""
    local verbose=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --token) KARAKEEP_TOKEN_VAL="$2"; shift 2 ;;
            --vimwiki) VIMWIKI_DIR="$2"; shift 2 ;;
            -m|--model) model="$2"; shift 2 ;;
            -v|--verbose) verbose=true; shift ;;
            -h|--help) _show_help; return 0 ;;
            *) echo "Unknown option: $1" >&2; return 1 ;;
        esac
    done
    
    # Unified logging functions
    _debug() {
        [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] $1" >&2
    }
    
    _info() {
        echo "[$FUNCTION_NAME] $1"
    }
    
    _error() {
        echo "[$FUNCTION_NAME] ERROR: $1" >&2
    }
    
    # Check dependencies
    for cmd in curl jq yt-dlp aichat; do
        command -v "$cmd" >/dev/null || { _error "Missing dependency: $cmd"; return 1; }
    done
    
    # Validate required parameters
    [[ -z "$KARAKEEP_TOKEN_VAL" ]] && { _error "Karakeep token not set. Use --token or KARAKEEP_TOKEN env"; return 1; }
    [[ -z "$KARAKEEP_HOST" ]] && { _error "Karakeep host not set. Use KARAKEEP_HOST env"; return 1; }
    [[ -z "$VIMWIKI_DIR" ]] && { _error "Vimwiki directory not set. Use --vimwiki or VIMWIKI_HOME env"; return 1; }
    
    local RESOURCES_DIR="$VIMWIKI_DIR/resources"
    mkdir -p "$RESOURCES_DIR" || { _error "Cannot create resources directory: $RESOURCES_DIR"; return 1; }
    
    # Build Karakeep search query for bookmarks with SUMMARIZE tag
    local search_query='tag:SUMMARIZE'
    
    # Query Karakeep API
    _fetch_bookmarks() {
        _debug "Querying Karakeep API for bookmarks with tag SUMMARIZE"
        
        # URL-encode the search query
        local encoded_query
        encoded_query="$(echo -n "$search_query" | jq -sRr @uri)"
        
        local resp
        resp="$(curl -sS \
            -H "Authorization: Bearer ${KARAKEEP_TOKEN_VAL}" \
            -H "Content-Type: application/json" \
            -X GET \
            "$KARAKEEP_HOST/api/v1/bookmarks/search?q=$encoded_query")" || { _error "Failed to query Karakeep API"; return 1; }
        
        # Clean control characters from response before parsing
        resp="$(echo "$resp" | tr -d '\000-\037')"
        
        # Check for API error
        if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
            _error "Karakeep API error: $(echo "$resp" | jq -r '.error')"
            return 1
        fi
        
        # Extract bookmarks with id, url, title, and type
        echo "$resp" | jq -r '.bookmarks[]? | (.id + "\t" + (.content.url // "") + "\t" + (.title // "Untitled") + "\t" + (.content.type // "unknown"))'
    }
    
    # Check if bookmark is a YouTube video
    _is_youtube_url() {
        local url="$1"
        [[ "$url" =~ (youtube\.com|youtu\.be) ]]
    }
    
    # Slugify a title for filename
    _slugify() {
        local title="$1"
        # Convert to lowercase, replace spaces with hyphens, remove special chars
        echo "$title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//'
    }
    
    # Summarize a YouTube video
    _summarize_video() {
        local url="$1" title="$2" bookmark_id="$3"
        
        _info "Processing video: $title"
        
        local tmp_dir
        tmp_dir="$(mktemp -d)" || { _error "Failed to create temp dir"; return 1; }
        
        local cleanup
        cleanup() {
            command rm -rf "$tmp_dir"
        }
        trap cleanup RETURN
        
        local outtmpl
        outtmpl="$tmp_dir/subtitle"
        
        _debug "Fetching transcript for: $url"
        yt-dlp --quiet --no-warnings \
            --write-auto-subs --sub-langs "en.*" --sub-format "vtt" \
            --skip-download -o "$outtmpl" \
            "$url" 2>/dev/null || { _error "Failed to fetch transcript for: $title"; return 1; }
        
        local transcript_file
        transcript_file="$(find "$tmp_dir" -maxdepth 1 -type f -name "*.vtt" -print -quit 2>/dev/null)"
        if [[ -z "$transcript_file" ]]; then
            _error "No English transcript found for: $title"
            return 1
        fi
        
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
        
        _debug "Generating summary with aichat"
        local summary
        summary=$(aichat "${aichat_args[@]}" "$prompt" < "$transcript_file" 2>/dev/null)
        
        if [[ -z "$summary" ]]; then
            _error "Failed to generate summary for: $title"
            return 1
        fi
        
        # Generate filename
        local slug
        slug=$(_slugify "$title")
        local output_file="$RESOURCES_DIR/${slug}-${bookmark_id}.md"
        
        # Write summary to file
        {
            echo "# $title"
            echo ""
            echo "**Source:** $url"
            echo "**Bookmark ID:** $bookmark_id"
            echo ""
            echo "$summary"
        } > "$output_file"
        
        _info "✓ Saved summary to: $output_file"
    }
    
    # Summarize non-video content
    _summarize_content() {
        local url="$1" title="$2" bookmark_id="$3"
        
        _info "Processing content: $title"
        
        # Fetch the content
        _debug "Fetching content from: $url"
        local content
        content="$(curl -sS -L --max-time 30 --max-redirs 5 "$url" 2>/dev/null)" || { _error "Failed to fetch content from: $url"; return 1; }
        
        if [[ -z "$content" ]]; then
            _error "Empty content fetched from: $url"
            return 1
        fi
        
        local prompt
        prompt=$(cat <<'EOF'
You are an AI assistant tasked with summarizing web content.

Follow these guidelines:
- Write a concise, high-signal summary of what the content is about.
- Capture the main thesis, key points, and any practical takeaways.
- Use clear structure with headings and bullet points where appropriate.
- If the content is noisy or incomplete, state assumptions and avoid hallucinations.

Output format:
## Summary

## Key Points

## Takeaways
EOF
        )
        
        local -a aichat_args
        aichat_args=()
        [[ -n "$model" ]] && aichat_args+=( -m "$model" )
        
        _debug "Generating summary with aichat"
        local summary
        summary=$(echo "$content" | aichat "${aichat_args[@]}" "$prompt" 2>/dev/null)
        
        if [[ -z "$summary" ]]; then
            _error "Failed to generate summary for: $title"
            return 1
        fi
        
        # Generate filename
        local slug
        slug=$(_slugify "$title")
        local output_file="$RESOURCES_DIR/${slug}-${bookmark_id}.md"
        
        # Write summary to file
        {
            echo "# $title"
            echo ""
            echo "**Source:** $url"
            echo "**Bookmark ID:** $bookmark_id"
            echo ""
            echo "$summary"
        } > "$output_file"
        
        _info "✓ Saved summary to: $output_file"
    }
    
    # Main execution logic
    _debug "Fetching bookmarks with SUMMARIZE tag"
    local total=0
    local success=0
    local failed=0
    
    while IFS=$'\t' read -r bookmark_id url title content_type; do
        ((total++))
        
        if [[ -z "$url" ]]; then
            _error "Skipping bookmark '$title' (ID: $bookmark_id): No URL found"
            ((failed++))
            continue
        fi
        
        if _is_youtube_url "$url"; then
            if _summarize_video "$url" "$title" "$bookmark_id"; then
                ((success++))
            else
                ((failed++))
            fi
        else
            if _summarize_content "$url" "$title" "$bookmark_id"; then
                ((success++))
            else
                ((failed++))
            fi
        fi
    done < <(_fetch_bookmarks)
    
    [[ $total -eq 0 ]] && _info "No bookmarks found with SUMMARIZE tag" && return 0
    
    _info "Complete. Processed: $total bookmarks (Success: $success, Failed: $failed)"
}
