#!/usr/bin/env bash
# YouTube Karakeep Sync
# Download YouTube videos from Karakeep bookmarks.

download-karakeep-videos() {
    local -r FUNCTION_NAME="download-karakeep-videos"
    
    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: download-karakeep-videos [options]

Download YouTube videos from Karakeep bookmarks.

Options:
  -t, --target DIR    Target directory for downloads (default: $VIDEO_FOLDER)
  --token TOKEN       Karakeep API token (default: $KARAKEEP_TOKEN)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq, yt-dlp
EOF
    }
    
    # Defaults from env
    local TARGET_DIR="${VIDEO_FOLDER:-}"
    local KARAKEEP_TOKEN_VAL="${KARAKEEP_TOKEN:-}"
    local KARAKEEP_HOST="${KARAKEEP_HOST:-}"
    local verbose=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -t|--target) TARGET_DIR="$2"; shift 2 ;;
            --token) KARAKEEP_TOKEN_VAL="$2"; shift 2 ;;
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
    for cmd in curl jq yt-dlp; do
        command -v "$cmd" >/dev/null || { _error "Missing dependency: $cmd"; return 1; }
    done
    

    
    # Build Karakeep search query
    # Search for bookmarks with YouTube URLs using the query language
    # URL filter supports multiple YouTube URL variants
    local search_query='(url:youtube.com OR url:youtu.be) AND -is:archived'
    
    # Query Karakeep API
    _fetch_items() {
        _debug "Querying Karakeep API"
        
        local resp
        resp="$(curl -sS \
            -H "Authorization: Bearer ${KARAKEEP_TOKEN_VAL}" \
            -H "Content-Type: application/json" \
            -X GET \
            "$KARAKEEP_HOST/api/v1/bookmarks?limit=10")" || { _error "Failed to query Karakeep API"; return 1; }
        
        # Clean control characters from response before parsing
        resp="$(echo "$resp" | tr -d '\000-\037')"
        
        # Check for API error
        if echo "$resp" | jq -e '.error' >/dev/null 2>&1; then
            _error "Karakeep API error: $(echo "$resp" | jq -r '.error')"
            return 1
        fi
        
        # Extract bookmarks with URL and title - filter for YouTube URLs
        echo "$resp" | jq -r '.bookmarks[]? | select(.content.url) | select(.content.url | test("youtube\\.com|youtu\\.be")) | (.id + "\t" + .content.url + "\t" + (.title // "Untitled"))'
    }
    
    # Check if video is already downloaded
    _is_video_downloaded() {
        local url="$1"
        # Extract video ID from URL
        local video_id
        video_id="$(echo "$url" | sed -n 's/.*[?&]v=\([^&]*\).*/\1/p; s/.*youtu\.be\/\([^?]*\).*/\1/p; s/.*embed\/\([^?]*\).*/\1/p' | head -1)"
        
        [[ -z "$video_id" ]] && return 1
        
        # Check if any file in target dir contains this video ID
        [[ -d "$TARGET_DIR" ]] && find "$TARGET_DIR" -name "*$video_id*" -type f | grep -q .
    }

    # Download a video
    _download_video() {
        local url="$1" title="$2"
        
        # Use the simple approach that works - just basic options
        local yt_opts=(
            -o "%(title)s-%(id)s.%(ext)s"
            -P "$TARGET_DIR"
        )
        
        [[ "$verbose" != true ]] && yt_opts+=(--quiet)
        
        yt-dlp "${yt_opts[@]}" "$url" || _error "Failed to download: $title"
    }
    
    # Validate required parameters
    [[ -z "$TARGET_DIR" ]] && { _error "Target directory not set. Use -t or VIDEO_FOLDER env"; return 1; }
    [[ -z "$KARAKEEP_TOKEN_VAL" ]] && { _error "Karakeep token not set. Use --token or KARAKEEP_TOKEN env"; return 1; }
    [[ -z "$KARAKEEP_HOST" ]] && { _error "Karakeep host not set. Use KARAKEEP_HOST env"; return 1; }
    
    mkdir -p "$TARGET_DIR" || { _error "Cannot create target directory: $TARGET_DIR"; return 1; }
    
    # Main execution logic
    _debug "Querying Karakeep API"
    local -a to_download=()
    local downloaded=0 total=0
    
    # First pass: collect videos that need downloading and show status
    while IFS=$'\t' read -r bookmark_id url title; do
        ((total++))
        if _is_video_downloaded "$url"; then
            _debug "$total. $title ✓ Already downloaded"
            ((downloaded++))
        else
            _info "$total. $title"
            to_download+=("$bookmark_id"$'\t'"$url"$'\t'"$title")
        fi
    done < <(_fetch_items)
    
    [[ $total -eq 0 ]] && _info "No videos found" && return 0
    
    if [[ ${#to_download[@]} -eq 0 ]]; then
        _info "All videos are already downloaded ($total/$total)"
        return 0
    fi
    
    echo ""
    _info "Starting downloads for ${#to_download[@]} video(s):"
    
    # Second pass: download the videos
    local i=1
    for item in "${to_download[@]}"; do
        IFS=$'\t' read -r bookmark_id url title <<< "$item"
        _info "[$i/${#to_download[@]}] Downloading: $title"
        _download_video "$url" "$title"
        ((i++))
    done
    
    _info "Complete. Downloaded: ${#to_download[@]}/$total videos"
}
