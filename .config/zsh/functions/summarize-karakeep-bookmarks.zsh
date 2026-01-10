#!/usr/bin/env bash
# Karakeep Bookmark Summarizer
# Summarizes Karakeep bookmarks tagged with SUMMARIZE and saves them to Wiki

summarize-karakeep-bookmarks() {
    local -r FUNCTION_NAME="summarize-karakeep-bookmarks"
    
    # Defaults
    local KARAKEEP_TOKEN_VAL="${KARAKEEP_TOKEN:-}"
    local KARAKEEP_HOST="${KARAKEEP_HOST:-}"
    local WIKI_DIR="${WIKI_HOME:-}"
    local model=""
    local verbose=false
    
    # Help
    if [[ "$1" == "-h" || "$1" == "--help" ]]; then
        cat << 'EOF'
Usage: summarize-karakeep-bookmarks [options]

Fetch bookmarks with tag SUMMARIZE from Karakeep, generate summaries, and save to Wiki.

Options:
  --token TOKEN       Karakeep API token (default: $KARAKEEP_TOKEN)
  --wiki DIR          Wiki home directory (default: $WIKI_HOME)
  -m, --model MODEL   AI model to use (passed to aichat)
  -v, --verbose       Enable verbose output
  -h, --help          Show this help

Dependencies: curl, jq, aichat, summarize-youtube
EOF
        return 0
    fi

    # Parse args
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --token) KARAKEEP_TOKEN_VAL="$2"; shift 2 ;;
            --wiki) WIKI_DIR="$2"; shift 2 ;;
            -m|--model) model="$2"; shift 2 ;;
            -v|--verbose) verbose=true; shift ;;
            *) echo "Unknown option: $1" >&2; return 1 ;;
        esac
    done
    
    # Validation
    [[ -z "$KARAKEEP_TOKEN_VAL" ]] && { echo "Error: Karakeep token not set." >&2; return 1; }
    [[ -z "$KARAKEEP_HOST" ]] && { echo "Error: Karakeep host not set." >&2; return 1; }
    [[ -z "$WIKI_DIR" ]] && { echo "Error: Wiki directory not set." >&2; return 1; }
    
    local RESOURCES_DIR="$WIKI_DIR/resources/inbox"
    mkdir -p "$RESOURCES_DIR"

    # Helpers
    _log() { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] $1" >&2; }
    _error() { echo "[$FUNCTION_NAME] ERROR: $1" >&2; }
    
    _slugify() {
        echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/--*/-/g; s/^-//; s/-$//'
    }

    _detach_tag() {
        local bookmark_id="$1"
        # Tag ID for "SUMMARIZE" (can be overridden via KARAKEEP_SUMMARIZE_TAG_ID)
        local tag_id="${KARAKEEP_SUMMARIZE_TAG_ID:-dve9xcn3na386hrvvijno3ys}"
        
        curl -sS -X DELETE \
            -H "Authorization: Bearer ${KARAKEEP_TOKEN_VAL}" \
            -H "Content-Type: application/json" \
            -d "{\"tags\":[{\"tagId\":\"$tag_id\"}]}" \
            "$KARAKEEP_HOST/api/v1/bookmarks/$bookmark_id/tags" >/dev/null
    }

    # Fetch bookmarks
    _log "Fetching bookmarks..."
    local search_query='#SUMMARIZE'
    local encoded_query
    encoded_query="$(echo -n "$search_query" | jq -sRr @uri)"
    
    local json_response
    json_response="$(curl -sS \
        -H "Authorization: Bearer ${KARAKEEP_TOKEN_VAL}" \
        "$KARAKEEP_HOST/api/v1/bookmarks/search?q=$encoded_query")"

    # Parse with jq
    local bookmarks
    bookmarks="$(echo "$json_response" | tr -d '\000-\037' | jq -r '.bookmarks[]? | @base64')"
    
    if [[ -z "$bookmarks" ]]; then
        _log "No bookmarks found."
        return 0
    fi

    local total=0 success=0 failed=0

    for row in $bookmarks; do
        ((total++))
        
        # Decode base64 row
        local _decoded
        _decoded="$(echo "$row" | base64 --decode)"
        
        local id url title
        id="$(echo "$_decoded" | jq -r .id)"
        url="$(echo "$_decoded" | jq -r .content.url)"
        title="$(echo "$_decoded" | jq -r '.title // "Untitled"')"
        
        if [[ -z "$url" || "$url" == "null" ]]; then
            _error "Skipping '$title': No URL"
            ((failed++)); continue
        fi

        local slug="$(_slugify "$title")"
        local output_file="$RESOURCES_DIR/$(date +%Y%m%d)-${slug}-${id}.md"
        
        _log "Processing: $title ($url)"
        
        # Prepare file header
        {
            echo "# $title"
            echo ""
            echo "**Source:** $url"
            echo "**Bookmark ID:** $id"
            echo ""
        } > "$output_file"

        local summary_result=""
        
        if [[ "$url" =~ (youtube\.com|youtu\.be) ]]; then
            # REUSE: summarize-youtube
            # Note: We append to output_file
            if summarize-youtube ${model:+--model "$model"} "$url" >> "$output_file"; then
                summary_result=0
            else
                summary_result=1
            fi
        else
            # Web content summary
            local content
            content="$(curl -sS -L --max-time 30 "$url")"
            if [[ -n "$content" ]]; then
                 echo "$content" | aichat ${model:+-m "$model"} \
                    "Summarize this web content. Concise, high-signal, markdown format." \
                    >> "$output_file"
                 summary_result=$?
            else
                summary_result=1
            fi
        fi

        if [[ "$summary_result" -eq 0 ]]; then
            echo "Saved: $output_file"
            _detach_tag "$id"
            ((success++))
        else
            _error "Failed to summarize: $title"
            rm -f "$output_file"
            ((failed++))
        fi
    done

    echo "Complete. Processed: $total (Success: $success, Failed: $failed)"
}
