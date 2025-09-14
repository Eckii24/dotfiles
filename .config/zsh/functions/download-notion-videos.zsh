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
            
            # Emit lines - use clean response and include title information
            local titles_found
            titles_found="$(echo "$clean_resp" | jq -r '
                .results[]
                | select(.properties.Url.url != null and .properties.Url.url != "")
                | .properties.Name.title[0].plain_text // "Untitled"
            ')"
            
            if [[ -n "$titles_found" ]]; then
                _log "Found videos:"
                while IFS= read -r title; do
                    _log "  - $title"
                done <<< "$titles_found"
            fi
            
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
    
    # Extract video ID from filename (supports multiple formats)
    _extract_id_from_filename() {
        local filename="$1"
        local video_id=""
        
        # YouTube video IDs are exactly 11 characters long
        # Handle multiple filename formats:
        # 1. title-VIDEO_ID.ext (e.g., "Some Video-Kf5-HWJPTIE.webm")
        # 2. [VIDEO_ID].ext (e.g., "[n4Lp4cV8YR0].mp4")
        
        # Try format: [VIDEO_ID].ext
        video_id=$(echo "$filename" | sed -n 's/.*\[\([^]]\{11\}\)\]\..*$/\1/p')
        
        # If not found, try format: title-VIDEO_ID.ext
        # Look for 11 characters followed by a dot and extension at the end
        if [[ -z "$video_id" ]]; then
            video_id=$(echo "$filename" | sed -n 's/.*-\(.\{11\}\)\.[^.]*$/\1/p')
        fi
        
        echo "$video_id"
    }
    
    # Get list of existing downloaded files and their video IDs
    _get_existing_files() {
        local target_dir="$1"
        local -A existing_files
        
        if [[ -d "$target_dir" ]]; then
            local file basename_file video_id
            for file in "$target_dir"/*; do
                if [[ -f "$file" ]]; then
                    basename_file=$(basename "$file")
                    video_id=$(_extract_id_from_filename "$basename_file")
                    if [[ -n "$video_id" ]]; then
                        existing_files["$video_id"]="$basename_file"
                    fi
                fi
            done
        fi
        
        # Output video_id:filename pairs
        local vid
        for vid in "${!existing_files[@]}"; do
            echo "$vid:${existing_files[$vid]}"
        done
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
        while IFS= read -r line; do
            local existing_id="${line%%:*}"
            if [[ "$existing_id" == "$video_id" ]]; then
                local filename="${line##*:}"
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
        while IFS= read -r line; do
            local existing_id="${line%%:*}"
            local filename="${line##*:}"
            
            if [[ -z "${notion_video_ids[$existing_id]:-}" ]]; then
                local filepath="$TARGET_DIR/$filename"
                _info "Removing orphaned file: $filename (video ID: $existing_id)"
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
        
        _info "  $index. $title"
        _log "page_id=$page_id"
        _log "url='$url'"
        _log "title='$title'"
        
        # Check if video is already downloaded
        if _is_video_downloaded "$url"; then
            _info "    ✓ Already downloaded, skipping"
            return 0
        fi
        
        # Download with yt-dlp
        yt-dlp \
            -o "%(title)s-%(id)s.%(ext)s" \
            -P "$TARGET_DIR" \
            "$url"
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
        
        _log "Found ${#items[@]} items. Starting sequential downloads. Target: $TARGET_DIR"
        
        # Process each item sequentially
        local index=1
        for item in "${items[@]}"; do
            _process_record "$item" "$index" "${#items[@]}"
            ((index++))
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
