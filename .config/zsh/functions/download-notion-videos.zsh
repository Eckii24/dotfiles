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
    local verbose_level=0
    
    # Parse command line arguments
    _parse_arguments() {
        local args=()
        while [[ $# -gt 0 ]]; do
            case "$1" in
                -t|--target)
                    TARGET_DIR="$2"
                    shift 2
                    ;;
                -r|--resources)
                    RES_DB_ID="$2"
                    shift 2
                    ;;
                --token)
                    NOTION_TOKEN_VAL="$2"
                    shift 2
                    ;;
                --debug)
                    verbose=true
                    verbose_level=1
                    export DEBUG_MODE=true
                    shift
                    ;;
                -v|--verbose)
                    verbose=true
                    verbose_level=1
                    shift
                    ;;
                -vv|--very-verbose)
                    verbose=true
                    verbose_level=2
                    shift
                    ;;
                -h|--help)
                    _show_help
                    return 0
                    ;;
                --)
                    shift
                    break
                    ;;
                *)
                    args+=("$1")
                    shift
                    ;;
            esac
        done
        set -- "${args[@]:-}"
    }
    
    # Display help information
    _show_help() {
        cat << 'EOF'
Usage: download-notion-videos [options]

Download YouTube videos from a Notion database.

Options:
  -t, --target DIR         Target directory for downloads (default: $VIDEO_FOLDER)
  -r, --resources ID       Notion database ID (default: $NOTION_RESOURCES_DB)
      --token TOKEN        Notion integration token (default: $NOTION_TOKEN)
      --debug              Enable debug mode with schema inspection
  -v, --verbose            Enable verbose output
  -vv, --very-verbose      Enable very verbose output (includes raw API responses)
  -h, --help               Show this help

Behavior:
  - Queries Notion DB for items where:
      Typ == "Video", Plattform == "Youtube", Status == "Next"
  - Checks if each video is already downloaded by matching video ID in filename
  - Downloads only new videos via yt-dlp sequentially  
  - Removes orphaned files (files in target dir not in Notion video list)
  - Does NOT modify the Downloaded flag in Notion

Dependencies: curl, jq, yt-dlp
EOF
    }
    
    # Logging function
    _log() {
        if [[ "$verbose" == true ]]; then
            echo "[$FUNCTION_NAME] $1" >&2
        fi
    }
    
    # Very verbose logging function (level 2)
    _log_vv() {
        if [[ "$verbose_level" -ge 2 ]]; then
            echo "[$FUNCTION_NAME] $1" >&2
        fi
    }
    
    # Info logging function (always shown)
    _info() {
        echo "[$FUNCTION_NAME] $1"
    }
    
    # Error logging function
    _error() {
        echo "[$FUNCTION_NAME] ERROR: $1" >&2
    }
    
    # Check if required dependencies are available
    _check_dependencies() {
        local missing_deps=()
        
        command -v curl >/dev/null 2>&1 || missing_deps+=("curl")
        command -v jq >/dev/null 2>&1 || missing_deps+=("jq")
        command -v yt-dlp >/dev/null 2>&1 || missing_deps+=("yt-dlp")
        
        if [[ ${#missing_deps[@]} -gt 0 ]]; then
            _error "Missing required dependencies: ${missing_deps[*]}"
            return 1
        fi
        
        return 0
    }
    
    # Validate input parameters
    _validate_inputs() {
        if [[ -z "${TARGET_DIR}" ]]; then
            _error "Target directory not set. Use -t or VIDEO_FOLDER env."
            return 1
        fi
        if [[ -z "${RES_DB_ID}" ]]; then
            _error "Notion database ID not set. Use -r or NOTION_RESOURCES_DB env."
            return 1
        fi
        if [[ -z "${NOTION_TOKEN_VAL}" ]]; then
            _error "Notion token not set. Use --token or NOTION_TOKEN env."
            return 1
        fi
        
        # Create target directory if it doesn't exist
        if ! mkdir -p "$TARGET_DIR" 2>/dev/null; then
            _error "Cannot create/access target dir: $TARGET_DIR"
            return 1
        fi
        
        return 0
    }
    
    # Inspect database schema for debugging
    _inspect_schema() {
        local db_id="$1"
        _log "Inspecting database schema..."
        
        local resp clean_resp
        resp="$(curl -sS \
            -H "Authorization: Bearer ${NOTION_TOKEN_VAL}" \
            -H "Notion-Version: ${NOTION_VERSION}" \
            "$NOTION_API/databases/$db_id")"
        
        clean_resp="$(echo "$resp" | tr -d '\000-\037\177')"
        
        if [[ "$(echo "$clean_resp" | jq -r '.object // empty')" == "error" ]]; then
            _error "Failed to get database schema: $(echo "$clean_resp" | jq -r '.code,.message // "Unknown error"' | paste -sd' - ' -)"
            return 1
        fi
        
        _log "Database properties:"
        if [[ "$verbose" == true ]]; then
            echo "$clean_resp" | jq -r '.properties | to_entries[] | "\(.key): \(.value.type)"'
        fi
        
        return 0
    }

    # Build Notion filter payload with multiple criteria
    _build_query_body() {
        # Filter by required criteria (removed Downloaded flag):
        # Typ multi_select contains "Video"
        # Plattform multi_select contains "Youtube"  
        # Status select equals "Next"
        jq -n '{
            "page_size": 100,
            "filter": {
                "and": [
                    {
                        "property": "Typ",
                        "multi_select": {
                            "contains": "Video"
                        }
                    },
                    {
                        "property": "Plattform",
                        "multi_select": {
                            "contains": "Youtube"
                        }
                    },
                    {
                        "property": "Status",
                        "status": {
                            "equals": "Next"
                        }
                    }
                ]
            }
        }'
    }
    
    # Query Notion with pagination; output tab-separated: page_id<TAB>url<TAB>title
    _fetch_items() {
        local db_id="$1"
        local body next_cursor has_more
        body="$(_build_query_body)"
        
        _log "Querying database with filter: Typ=Video AND Plattform=Youtube AND Status=Next"
        
        local H_AUTH=(
            -H "Authorization: Bearer ${NOTION_TOKEN_VAL}"
            -H "Notion-Version: ${NOTION_VERSION}"
            -H "Content-Type: application/json"
        )
        
        while :; do
            local resp
            if [[ -n "${next_cursor-}" ]]; then
                resp="$(jq -n --argjson base "$body" --arg sc "$next_cursor" '$base + {"start_cursor":$sc}' \
                    | curl -sS "${H_AUTH[@]}" -X POST \
                      "$NOTION_API/databases/$db_id/query" \
                      --data @-)"
            else
                resp="$(echo "$body" | curl -sS "${H_AUTH[@]}" -X POST \
                      "$NOTION_API/databases/$db_id/query" \
                      --data @-)"
            fi
            
            # Check for API error - first sanitize control characters
            local clean_resp
            clean_resp="$(echo "$resp" | tr -d '\000-\037\177')"
            
            _log_vv "Raw API response: $clean_resp"
            
            if [[ "$(echo "$clean_resp" | jq -r '.object // empty')" == "error" ]]; then
                _error "Notion API error: $(echo "$clean_resp" | jq -r '.code,.message // "Unknown error"' | paste -sd' - ' -)"
                _error "Request body was: $body"
                return 1
            fi
            
            # Emit lines - use clean response
            echo "$clean_resp" | jq -r '
                .results[]
                | .id as $id
                | .properties.Url.url as $url
                | .properties.Name.title[0].plain_text // "Untitled" as $title
                | select($url != null and $url != "")
                | ($id + "\t" + $url + "\t" + $title)
            '
            
            has_more="$(echo "$clean_resp" | jq -r '.has_more // false')"
            if [[ "$has_more" != "true" ]]; then
                break
            fi
            next_cursor="$(echo "$clean_resp" | jq -r '.next_cursor // empty')"
        done
    }
    
    # Extract YouTube video ID from URL
    _extract_video_id() {
        local url="$1"
        # Handle different YouTube URL formats:
        # https://www.youtube.com/watch?v=VIDEO_ID
        # https://youtu.be/VIDEO_ID
        # https://www.youtube.com/embed/VIDEO_ID
        echo "$url" | sed -n 's/.*[?&]v=\([^&]*\).*/\1/p; s/.*youtu\.be\/\([^?]*\).*/\1/p; s/.*embed\/\([^?]*\).*/\1/p' | head -1
    }
    
    # Check if video ID is contained in filename (simple contains check)
    _video_id_in_filename() {
        local filename="$1"
        local video_id="$2"
        
        # Simple contains check - if video ID is anywhere in the filename, consider it a match
        if [[ "$filename" == *"$video_id"* ]]; then
            return 0  # Found
        fi
        
        return 1  # Not found
    }
    
    # Get list of existing downloaded files
    _get_existing_files() {
        local target_dir="$1"
        
        if [[ -d "$target_dir" ]]; then
            local file basename_file
            for file in "$target_dir"/*; do
                if [[ -f "$file" ]]; then
                    basename_file=$(basename "$file")
                    echo "$basename_file"
                fi
            done
        fi
    }
    
    # Check if video is already downloaded
    _is_video_downloaded() {
        local url="$1"
        local video_id
        video_id="$(_extract_video_id "$url")"
        
        if [[ -z "$video_id" ]]; then
            _log "Could not extract video ID from URL: $url"
            return 1  # Assume not downloaded if we can't extract ID
        fi
        
        # Check if any existing file contains this video ID
        while IFS= read -r filename; do
            [[ -z "$filename" ]] && continue
            if _video_id_in_filename "$filename" "$video_id"; then
                _log "Video $video_id already downloaded as: $filename"
                return 0  # Already downloaded
            fi
        done < <(_get_existing_files "$TARGET_DIR")
        
        return 1  # Not downloaded
    }
    
    # Clean up orphaned files (files not in Notion video list)
    _cleanup_orphaned_files() {
        local items_ref=("$@")
        local -A notion_video_ids
        local item
        
        # Build set of video IDs from Notion
        for item in "${items_ref[@]}"; do
            local page_id url title
            IFS=$'\t' read -r page_id url title <<< "$item"
            local video_id
            video_id="$(_extract_video_id "$url")"
            if [[ -n "$video_id" ]]; then
                notion_video_ids["$video_id"]=1
            fi
        done
        
        # Check existing files and remove orphans
        local orphaned_count=0
        while IFS= read -r filename; do
            [[ -z "$filename" ]] && continue
            
            # Check if this file contains any of the known video IDs
            local is_orphan=true
            for video_id in "${!notion_video_ids[@]}"; do
                if _video_id_in_filename "$filename" "$video_id"; then
                    is_orphan=false
                    break
                fi
            done
            
            if [[ "$is_orphan" == true ]]; then
                local filepath="$TARGET_DIR/$filename"
                _info "Removing orphaned file: $filename"
                if rm -f "$filepath"; then
                    ((orphaned_count++))
                else
                    _error "Failed to remove orphaned file: $filepath"
                fi
            fi
        done < <(_get_existing_files "$TARGET_DIR")
        
        if [[ $orphaned_count -gt 0 ]]; then
            _info "Removed $orphaned_count orphaned file(s)"
        else
            _log "No orphaned files found"
        fi
    }
    
    # Update page: set Downloaded=true
    _mark_downloaded() {
        local page_id="$1"
        local payload='{"properties":{"Downloaded":{"checkbox":true}}}'
        local resp clean_resp
        resp="$(curl -sS \
                -H "Authorization: Bearer ${NOTION_TOKEN_VAL}" \
                -H "Notion-Version: ${NOTION_VERSION}" \
                -H "Content-Type: application/json" \
                -X PATCH "$NOTION_API/pages/$page_id" --data "$payload")"
        
        # Sanitize control characters
        clean_resp="$(echo "$resp" | tr -d '\000-\037\177')"
        
        if [[ "$(echo "$clean_resp" | jq -r '.object // empty')" == "error" ]]; then
            _error "Update failed for $page_id: $(echo "$clean_resp" | jq -r '.code,.message // "Unknown error"' | paste -sd' - ' -)"
            return 1
        fi
        return 0
    }
    
    # Process one record "page_id<TAB>url<TAB>title"
    _process_record() {
        local rec="$1"
        local index="$2"
        local total="$3"
        local page_id url title
        IFS=$'\t' read -r page_id url title <<< "$rec"
        
        if [[ "$verbose" == true ]]; then
            _log "page_id=$page_id"
            _log "url='$url'"
            _log "title='$title'"
        fi
        
        # Check if video is already downloaded
        if _is_video_downloaded "$url"; then
            return 0  # Skip, already shown in the summary
        fi
        
        # Download with yt-dlp
        if [[ "$verbose" == true ]]; then
            yt-dlp \
                -o "%(title)s-%(id)s.%(ext)s" \
                -P "$TARGET_DIR" \
                "$url"
        else
            # Suppress yt-dlp output in non-verbose mode
            yt-dlp \
                -o "%(title)s-%(id)s.%(ext)s" \
                -P "$TARGET_DIR" \
                --quiet \
                "$url"
        fi
        local rc=$?
        
        if [[ $rc -eq 0 ]]; then
            _log "Downloaded $url successfully"
        else
            _error "yt-dlp exit $rc for $url"
        fi
    }
    
    # Main execution logic
    _main() {
        if [[ "${DEBUG_MODE:-false}" == "true" ]]; then
            _inspect_schema "$RES_DB_ID" || return 1
        fi
        
        _log "Querying Notion database: $RES_DB_ID"
        local items=()
        while IFS= read -r line; do
            items+=("$line")
        done < <(_fetch_items "$RES_DB_ID") || return 1
        
        if [[ ${#items[@]} -eq 0 ]]; then
            _info "No matching items."
            return 0
        fi
        
        _log "Found ${#items[@]} items. Checking download status..."
        
        # Show complete list of videos with download status
        local index=1
        local to_download=()
        for item in "${items[@]}"; do
            local page_id url title
            IFS=$'\t' read -r page_id url title <<< "$item"
            
            if _is_video_downloaded "$url"; then
                _info "  $index. $title ✓ Already downloaded"
            else
                _info "  $index. $title"
                to_download+=("$item")
            fi
            ((index++))
        done
        
        if [[ ${#to_download[@]} -eq 0 ]]; then
            _info "All videos are already downloaded."
            # Still run cleanup for orphaned files
            _log "Checking for orphaned files to clean up..."
            _cleanup_orphaned_files "${items[@]}"
            return 0
        fi
        
        _info ""
        _info "Starting downloads for ${#to_download[@]} new video(s). Target: $TARGET_DIR"
        
        # Process only videos that need to be downloaded
        local download_index=1
        for item in "${to_download[@]}"; do
            local page_id url title
            IFS=$'\t' read -r page_id url title <<< "$item"
            _info "Downloading $download_index/${#to_download[@]}: $title"
            _process_record "$item" "$download_index" "${#to_download[@]}"
            ((download_index++))
        done
        
        _info "Downloads completed."
        
        # Clean up orphaned files
        _log "Checking for orphaned files to clean up..."
        _cleanup_orphaned_files "${items[@]}"
    }
    
    # Parse arguments
    if ! _parse_arguments "$@"; then
        return 1
    fi
    
    _log "Starting $FUNCTION_NAME"
    
    # Check dependencies
    if ! _check_dependencies; then
        return 1
    fi
    
    # Validate inputs
    if ! _validate_inputs; then
        return 1
    fi
    
    # Run main logic
    if ! _main; then
        _error "Failed to complete operation"
        return 1
    fi
    
    _log "$FUNCTION_NAME completed successfully"
    return 0
}
