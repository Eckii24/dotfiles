set-copilot-api-key() {
    local need_refresh=false
    local VERBOSE=false

    # Check for -v or --verbose in arguments
    for arg in "$@"; do
        if [[ "$arg" == "-v" || "$arg" == "--verbose" ]]; then
            VERBOSE=true
        fi
    done

    log() {
        if [[ "$VERBOSE" == true ]]; then
            echo "[set-copilot-api-key] $1"
        fi
    }

    log "Starting set-copilot-api-key function"
    # Check if COPILOT_API_KEY is missing or expired
    if [[ -z "$COPILOT_API_KEY" ]]; then
        log "COPILOT_API_KEY is missing, need to refresh"
        need_refresh=true
    else
        local current_time exp_string exp_time
        current_time=$(date +%s)
        log "Current time: $current_time"
        exp_string=$(echo "$COPILOT_API_KEY" | grep -o "exp=[0-9]*" | head -n 1)
        log "Extracted expiration string: $exp_string"
        if [[ -n "$exp_string" ]]; then
            exp_time="${exp_string#exp=}"
            log "Token expiration time: $exp_time"
            if [[ "$current_time" -ge "$exp_time" ]]; then
                log "Token expired, need to refresh"
                need_refresh=true
            else
                log "Token is still valid"
            fi
        else
            log "No expiration found in token, need to refresh"
            need_refresh=true
        fi
    fi

    if [[ "$need_refresh" == true ]]; then
        log "Refreshing COPILOT_API_KEY"
        local OAUTH_TOKEN
        log "Reading OAUTH_TOKEN from ~/.config/github-copilot/apps.json"
        OAUTH_TOKEN=$(bat ~/.config/github-copilot/apps.json | jq 'to_entries | .[] | select(.key | startswith("github.com:")) | .value.oauth_token' -r)
        log "OAUTH_TOKEN obtained: $OAUTH_TOKEN"
        export COPILOT_API_KEY
        log "Requesting new COPILOT_API_KEY from GitHub API"
        local curl_response
        curl_response=$(curl -s -H "Authorization: Bearer $OAUTH_TOKEN" "https://api.github.com/copilot_internal/v2/token")
        log "Raw curl response: $curl_response"
        COPILOT_API_KEY=$(echo "$curl_response" | jq .token -r)
        log "COPILOT_API_KEY set"
        echo "Token set at COPILOT_API_KEY"
    fi
    log "set-copilot-api-key function finished"
}
