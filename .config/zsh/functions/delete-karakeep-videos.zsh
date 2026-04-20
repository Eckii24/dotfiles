#!/usr/bin/env bash
# YouTube Karakeep Cleanup
# Delete YouTube videos that are no longer in Karakeep bookmarks.

delete-karakeep-videos() {
    local -r FUNCTION_NAME="delete-karakeep-videos"
    
    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: delete-karakeep-videos [options]

Delete YouTube videos that are no longer in Karakeep bookmarks.

Options:
  -t, --target DIR    Target directory for videos (default: $VIDEO_FOLDER)
  --token TOKEN       Karakeep API token (default: $KARAKEEP_TOKEN)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq
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
    for cmd in curl jq; do
        command -v "$cmd" >/dev/null || { _error "Missing dependency: $cmd"; return 1; }
    done
    
    # Build Karakeep search query
    # Search for bookmarks with YouTube URLs using the query language
    # URL filter supports multiple YouTube URL variants
    local search_query='(url:youtube.com or url:youtu.be) and -is:archived'
    
    # Query Karakeep API
    _fetch_items() {
        _debug "Querying Karakeep API"
        
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
        
        # Extract bookmarks with URL and title - filter for YouTube URLs
        echo "$resp" | jq -r '.bookmarks[]? | select(.content.url) | select(.content.url | test("youtube\\.com|youtu\\.be")) | (.id + "\t" + .content.url + "\t" + (.title // "Untitled"))'
    }
    
    # Extract video ID from URL
    _extract_video_id() {
        local url="$1"
        echo "$url" | sed -n 's/.*[?&]v=\([^&]*\).*/\1/p; s/.*youtu\.be\/\([^?]*\).*/\1/p; s/.*embed\/\([^?]*\).*/\1/p' | head -1
    }
    
    # Validate required parameters
    [[ -z "$TARGET_DIR" ]] && { _error "Target directory not set. Use -t or VIDEO_FOLDER env"; return 1; }
    [[ -z "$KARAKEEP_TOKEN_VAL" ]] && { _error "Karakeep token not set. Use --token or KARAKEEP_TOKEN env"; return 1; }
    [[ -z "$KARAKEEP_HOST" ]] && { _error "Karakeep host not set. Use KARAKEEP_HOST env"; return 1; }
    
    [[ ! -d "$TARGET_DIR" ]] && { _error "Target directory does not exist: $TARGET_DIR"; return 1; }
    
    # Main execution logic
    _debug "Querying Karakeep API to get current bookmarks"
    
    # Build a set of video IDs that are in Karakeep
    local -A karakeep_video_ids=()
    while IFS=$'\t' read -r _bookmark_id url _title; do
        local video_id
        video_id="$(_extract_video_id "$url")"
        if [[ -n "$video_id" ]]; then
            karakeep_video_ids[$video_id]=1
            _debug "Found Karakeep video ID: $video_id (from URL: $url)"
        fi
    done < <(_fetch_items)
    
    _debug "Found ${#karakeep_video_ids[@]} video(s) in Karakeep"
    
    if [[ "$verbose" == true ]]; then
        _debug "Karakeep video IDs:"
        for vid_id in "${!karakeep_video_ids[@]}"; do
            _debug "  - $vid_id"
        done
    fi
    
    # Find all video files in the target directory (top level only)
    local -a downloaded_files=()
    while IFS= read -r file; do
        downloaded_files+=("$file")
    done < <(find "$TARGET_DIR" -maxdepth 1 -type f \( -name "*.mp4" -o -name "*.webm" -o -name "*.mkv" -o -name "*.m4a" -o -name "*.opus" \) 2>/dev/null)
    
    [[ ${#downloaded_files[@]} -eq 0 ]] && { _info "No video files found in $TARGET_DIR"; return 0; }
    
    _debug "Found ${#downloaded_files[@]} video file(s) in target directory"
    
    # Find files that are no longer in Karakeep
    local -a orphaned_files=()
    for file in "${downloaded_files[@]}"; do
        local basename
        basename="$(basename "$file")"
        local file_has_match=false
        
        # Extract video ID from filename based on yt-dlp naming pattern: %(title)s-%(id)s.%(ext)s
        # The video ID is the part between the last hyphen and the extension
        local potential_id
        potential_id="$(echo "$basename" | sed -n 's/.*-\([A-Za-z0-9_-]\{11\}\)\.[^.]*$/\1/p')"
        
        # First, try fast O(1) lookup with extracted ID
        if [[ -n "$potential_id" && -n "${karakeep_video_ids[$potential_id]}" ]]; then
            file_has_match=true
            _debug "File '$basename' matches Karakeep video ID: $potential_id (fast path)"
        else
            # Fallback: check if any Karakeep video ID appears in the filename
            # This handles edge cases where extraction might fail or filename format differs
            for video_id in "${!karakeep_video_ids[@]}"; do
                if [[ "$basename" == *"$video_id"* ]]; then
                    file_has_match=true
                    _debug "File '$basename' matches Karakeep video ID: $video_id (fallback path)"
                    break
                fi
            done
        fi
        
        if [[ "$file_has_match" == false ]]; then
            _debug "File '$basename' has no matching video ID in Karakeep"
        fi
        
        # If no match found, this file is orphaned
        [[ "$file_has_match" == false ]] && orphaned_files+=("$file")
    done
    
    # If no orphaned files, we're done
    if [[ ${#orphaned_files[@]} -eq 0 ]]; then
        _info "No orphaned videos found. All downloaded videos are still in Karakeep."
        return 0
    fi
    
    # Display numbered list of orphaned files
    echo ""
    _info "Found ${#orphaned_files[@]} video(s) that are no longer in Karakeep:"
    echo ""
    local i=1
    for file in "${orphaned_files[@]}"; do
        echo "$i. $(basename "$file")"
        ((i++))
    done
    
    # Ask user which files to delete
    echo ""
    echo -n "Enter numbers to delete (comma or space separated, or 'all' for all, or 'q' to quit): "
    read -r user_input
    
    # Handle quit
    [[ "$user_input" == "q" ]] && { _info "Cancelled."; return 0; }
    
    # Determine which files to delete
    local -a files_to_delete=()
    if [[ "$user_input" == "all" ]]; then
        files_to_delete=("${orphaned_files[@]}")
    else
        # Parse the input (supports both comma and space separated)
        local normalized_input
        normalized_input="$(echo "$user_input" | tr ',' ' ')"
        
        for num in $normalized_input; do
            # Validate number
            if [[ ! "$num" =~ ^[0-9]+$ ]]; then
                _error "Invalid input: '$num' is not a number"
                continue
            fi
            
            # Check bounds
            if [[ $num -lt 1 || $num -gt ${#orphaned_files[@]} ]]; then
                _error "Invalid number: $num (must be between 1 and ${#orphaned_files[@]})"
                continue
            fi
            
            # Add to deletion list (convert to 0-based index)
            files_to_delete+=("${orphaned_files[$((num-1))]}")
        done
    fi
    
    # If no valid selections, exit
    [[ ${#files_to_delete[@]} -eq 0 ]] && { _info "No files selected for deletion."; return 0; }
    
    # Confirm deletion
    echo ""
    _info "About to delete ${#files_to_delete[@]} file(s):"
    for file in "${files_to_delete[@]}"; do
        echo "  - $(basename "$file")"
    done
    echo ""
    echo -n "Confirm deletion? (y/N): "
    read -r confirm
    
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { _info "Cancelled."; return 0; }
    
    # Delete the files
    local deleted=0
    for file in "${files_to_delete[@]}"; do
        if rm -f "$file"; then
            _info "Deleted: $(basename "$file")"
            ((deleted++))
        else
            _error "Failed to delete: $(basename "$file")"
        fi
    done
    
    _info "Complete. Deleted $deleted/${#files_to_delete[@]} file(s)."
}
