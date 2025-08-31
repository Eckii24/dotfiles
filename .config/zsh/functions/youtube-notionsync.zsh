#!/usr/bin/env bash
# YouTube Notion Sync
# Download YouTube videos from a Notion DB and mark them as Downloaded.

youtube-notionsync() {
    local -r NOTION_API="https://api.notion.com/v1"
    local -r NOTION_VERSION="${NOTION_VERSION:-2022-06-28}"
    local -r FUNCTION_NAME="youtube-notionsync"
    
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
Usage: youtube-notionsync [options]

Download YouTube videos from a Notion database and mark them as Downloaded.

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
      Typ == "Video", Plattform == "Youtube", Status == "Next", Downloaded == false
  - Downloads each Url via yt-dlp sequentially
  - On success, sets Downloaded=true for that Notion page

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
        _info "Inspecting database schema..."
        
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
        
        _info "Database properties:"
        echo "$clean_resp" | jq -r '.properties | to_entries[] | "\(.key): \(.value.type)"'
        
        return 0
    }

    # Build Notion filter payload with multiple criteria
    _build_query_body() {
        # Filter by all required criteria:
        # Typ select equals "Video"
        # Plattform select equals "Youtube"  
        # Status select equals "Next"
        # Downloaded checkbox equals false
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
                            "equals": "Youtube"
                        }
                    },
                    {
                        "property": "Status",
                        "select": {
                            "equals": "Next"
                        }
                    },
                    {
                        "property": "Downloaded",
                        "checkbox": {
                            "equals": false
                        }
                    }
                ]
            }
        }'
    }
    
    # Query Notion with pagination; output tab-separated: page_id<TAB>url
    _fetch_items() {
        local db_id="$1"
        local body next_cursor has_more
        body="$(_build_query_body)"
        
        _log "Querying database with filter: Typ=Video AND Plattform=Youtube AND Status=Next AND Downloaded=false"
        
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
            
            # Emit lines - use clean response and show meaningful info
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
                | select($url != null and $url != "")
                | ($id + "\t" + $url)
            '
            
            has_more="$(echo "$clean_resp" | jq -r '.has_more // false')"
            if [[ "$has_more" != "true" ]]; then
                break
            fi
            next_cursor="$(echo "$clean_resp" | jq -r '.next_cursor // empty')"
        done
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
    
    # Process one record "page_id<TAB>url"
    _process_record() {
        local rec="$1"
        local page_id url
        IFS=$'\t' read -r page_id url <<< "$rec"
        
        echo "[START] $page_id <- $url"
        # Download with yt-dlp
        yt-dlp \
            -o "%(title)s-%(id)s.%(ext)s" \
            -P "$TARGET_DIR" \
            "$url"
        local rc=$?
        
        if [[ $rc -eq 0 ]]; then
            echo "[OK] Downloaded $url -> marking downloaded"
            if _mark_downloaded "$page_id"; then
                echo "[OK] Updated Notion page $page_id"
            else
                echo "[WARN] Downloaded, but failed to update Notion for $page_id" >&2
            fi
        else
            echo "[FAIL] yt-dlp exit $rc for $url" >&2
        fi
    }
    
    # Main execution logic
    _main() {
        if [[ "${DEBUG_MODE:-false}" == "true" ]]; then
            _inspect_schema "$RES_DB_ID" || return 1
        fi
        
        _info "Querying Notion database: $RES_DB_ID"
        local items=()
        while IFS= read -r line; do
            items+=("$line")
        done < <(_fetch_items "$RES_DB_ID") || return 1
        
        if [[ ${#items[@]} -eq 0 ]]; then
            _info "No matching items."
            return 0
        fi
        
        _info "Found ${#items[@]} items. Starting sequential downloads. Target: $TARGET_DIR"
        
        # Process each item sequentially
        for item in "${items[@]}"; do
            _process_record "$item"
        done
        
        _info "Downloads completed."
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
