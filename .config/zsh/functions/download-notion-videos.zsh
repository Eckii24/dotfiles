#!/usr/bin/env bash
# YouTube Notion Sync
# Download YouTube videos from a Notion DB.

download-notion-videos() {
    local -r NOTION_API="https://api.notion.com/v1"
    local -r NOTION_VERSION="${NOTION_VERSION:-2022-06-28}"
    local -r FUNCTION_NAME="download-notion-videos"
    
    # Defaults from env
    local TARGET_DIR="${VIDEO_FOLDER:-}"
    local RES_DB_ID="${NOTION_RESOURCES_DB:-}"
    local NOTION_TOKEN_VAL="${NOTION_TOKEN:-}"
    local verbose=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            -t|--target) TARGET_DIR="$2"; shift 2 ;;
            -r|--resources) RES_DB_ID="$2"; shift 2 ;;
            --token) NOTION_TOKEN_VAL="$2"; shift 2 ;;
            -v|--verbose) verbose=true; shift ;;
            -h|--help) _show_help; return 0 ;;
            *) echo "Unknown option: $1" >&2; return 1 ;;
        esac
    done
    
    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: download-notion-videos [options]

Download YouTube videos from a Notion database.
Checks recursively in all subdirectories to avoid re-downloading existing videos.

Options:
  -t, --target DIR    Target directory for downloads (default: $VIDEO_FOLDER)
  -r, --resources ID  Notion database ID (default: $NOTION_RESOURCES_DB)
  --token TOKEN       Notion integration token (default: $NOTION_TOKEN)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq, yt-dlp
EOF
    }
    
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
    

    
    # Build Notion query filter
    _query_body='{"page_size":100,"filter":{"and":[{"property":"Typ","multi_select":{"contains":"Video"}},{"property":"Plattform","multi_select":{"contains":"Youtube"}},{"property":"Status","status":{"equals":"Next"}}]}}'
    
    # Query Notion database
    _fetch_items() {
        local db_id="$1"
        _debug "Querying Notion database"
        
        local resp
        resp="$(curl -sS \
            -H "Authorization: Bearer ${NOTION_TOKEN_VAL}" \
            -H "Notion-Version: ${NOTION_VERSION}" \
            -H "Content-Type: application/json" \
            -X POST \
            "$NOTION_API/databases/$db_id/query" \
            -d "$_query_body")" || { _error "Failed to query Notion API"; return 1; }
        
        # Check for API error and extract data
        if echo "$resp" | jq -e '.object == "error"' >/dev/null; then
            _error "Notion API error: $(echo "$resp" | jq -r '.message')"
            return 1
        fi
        
        echo "$resp" | jq -r '.results[] | select(.properties.Url.url) | (.id + "\t" + .properties.Url.url + "\t" + (.properties.Name.title[0].plain_text // "Untitled"))'
    }
    
    # Check if video is already downloaded
    _is_video_downloaded() {
        local url="$1"
        # Extract video ID from URL
        local video_id
        video_id="$(echo "$url" | sed -n 's/.*[?&]v=\([^&]*\).*/\1/p; s/.*youtu\.be\/\([^?]*\).*/\1/p; s/.*embed\/\([^?]*\).*/\1/p' | head -1)"
        
        [[ -z "$video_id" ]] && return 1
        
        # Check if any file in target dir (recursively searching all subdirectories) contains this video ID
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
    [[ -z "$RES_DB_ID" ]] && { _error "Notion database ID not set. Use -r or NOTION_RESOURCES_DB env"; return 1; }
    [[ -z "$NOTION_TOKEN_VAL" ]] && { _error "Notion token not set. Use --token or NOTION_TOKEN env"; return 1; }
    
    mkdir -p "$TARGET_DIR" || { _error "Cannot create target directory: $TARGET_DIR"; return 1; }
    
    # Main execution logic
    _debug "Querying Notion database"
    local -a to_download=()
    local downloaded=0 total=0
    
    # First pass: collect videos that need downloading and show status
    while IFS=$'\t' read -r page_id url title; do
        ((total++))
        if _is_video_downloaded "$url"; then
            _debug "$total. $title ✓ Already downloaded"
            ((downloaded++))
        else
            _info "$total. $title"
            to_download+=("$page_id"$'\t'"$url"$'\t'"$title")
        fi
    done < <(_fetch_items "$RES_DB_ID")
    
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
        IFS=$'\t' read -r page_id url title <<< "$item"
        _info "[$i/${#to_download[@]}] Downloading: $title"
        _download_video "$url" "$title"
        ((i++))
    done
    
    _info "Complete. Downloaded: ${#to_download[@]}/$total videos"
}
