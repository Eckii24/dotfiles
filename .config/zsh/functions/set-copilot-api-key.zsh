# GitHub Copilot API Key Management
# Sets or refreshes the COPILOT_API_KEY environment variable
set-copilot-api-key() {
    local -r APPS_JSON_PATH="$HOME/.config/github-copilot/apps.json"
    local -r GITHUB_API_URL="https://api.github.com/copilot_internal/v2/token"
    local -r FUNCTION_NAME="set-copilot-api-key"
    
    local verbose=false
    local very_verbose=false
    local force_refresh=false
    local need_refresh=false
    
    # Parse command line arguments
    _parse_arguments() {
        for arg in "$@"; do
            case "$arg" in
                -vv|--very-verbose)
                    very_verbose=true
                    verbose=true
                    ;;
                -v|--verbose)
                    verbose=true
                    ;;
                -f|--force)
                    force_refresh=true
                    ;;
                -h|--help)
                    _show_help
                    return 0
                    ;;
                *)
                    echo "Error: Unknown argument '$arg'" >&2
                    _show_help
                    return 1
                    ;;
            esac
        done
    }
    
    # Display help information
    _show_help() {
        cat << EOF
Usage: $FUNCTION_NAME [OPTIONS]

Sets or refreshes the COPILOT_API_KEY environment variable using GitHub OAuth token.

OPTIONS:
    -v, --verbose        Enable verbose output
    -vv, --very-verbose  Enable very verbose output (includes raw API response)
    -f, --force          Force refresh even if token is valid
    -h, --help           Show this help message

DESCRIPTION:
    This function checks if COPILOT_API_KEY exists and is valid. If not, or if --force is used, it retrieves
    a new token from GitHub's API using the OAuth token stored in GitHub Copilot's
    configuration file.
    The raw API response is only logged if --very-verbose is set.
EOF
    }
    
    # Logging function
    _log() {
        if [[ "$verbose" == true ]]; then
            echo "[$FUNCTION_NAME] $1" >&2
        fi
    }
    
    # Error logging function
    _error() {
        echo "[$FUNCTION_NAME] ERROR: $1" >&2
    }
    
    # Check if required dependencies are available
    _check_dependencies() {
        local missing_deps=()
        
        command -v jq >/dev/null 2>&1 || missing_deps+=("jq")
        command -v curl >/dev/null 2>&1 || missing_deps+=("curl")
        
        if [[ ${#missing_deps[@]} -gt 0 ]]; then
            _error "Missing required dependencies: ${missing_deps[*]}"
            return 1
        fi
        
        return 0
    }
    
    # Extract expiration time from token
    _extract_token_expiration() {
        local token="$1"
        local exp_string
        
        exp_string=$(echo "$token" | grep -o "exp=[0-9]*" | head -n 1)
        
        if [[ -n "$exp_string" ]]; then
            echo "${exp_string#exp=}"
            return 0
        fi
        
        return 1
    }
    
    # Check if current token is valid
    _is_token_valid() {
        if [[ -z "$COPILOT_API_KEY" ]]; then
            _log "COPILOT_API_KEY is not set"
            return 1
        fi
        
        local current_time exp_time
        current_time=$(date +%s)
        
        if ! exp_time=$(_extract_token_expiration "$COPILOT_API_KEY"); then
            _log "No expiration found in token"
            return 1
        fi
        
        _log "Current time: $current_time, Token expiration: $exp_time"
        
        if [[ "$current_time" -ge "$exp_time" ]]; then
            _log "Token has expired"
            return 1
        fi
        
        _log "Token is still valid"
        return 0
    }
    
    # Get OAuth token from GitHub Copilot config
    _get_oauth_token() {
        if [[ ! -f "$APPS_JSON_PATH" ]]; then
            _error "GitHub Copilot config file not found: $APPS_JSON_PATH"
            _error "Please ensure GitHub Copilot is properly configured"
            return 1
        fi

        local oauth_token
        # Always use cat, and only take the first oauth_token found
        oauth_token=$(cat "$APPS_JSON_PATH" | jq -r 'to_entries | .[] | select(.key | startswith("github.com:")) | .value.oauth_token' 2>/dev/null | head -n 1)

        if [[ -z "$oauth_token" || "$oauth_token" == "null" ]]; then
            _error "Failed to extract OAuth token from $APPS_JSON_PATH"
            _error "Please check your GitHub Copilot configuration"
            return 1
        fi
        
        echo "$oauth_token"
        return 0
    }
    
    # Refresh COPILOT_API_KEY from GitHub API
    _refresh_api_key() {
        local oauth_token curl_response api_key

        _log "Refreshing COPILOT_API_KEY"

        if ! oauth_token=$(_get_oauth_token); then
            return 1
        fi

        _log "OAuth token obtained ($oauth_token), requesting new API key"

        curl_response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $oauth_token" \
            -H "Accept: application/vnd.github+json" \
            "$GITHUB_API_URL" 2>/dev/null)

        local http_code="${curl_response##*$'\n'}"
        local response_body="${curl_response%$'\n'*}"

        if [[ "$very_verbose" == true ]]; then
            _log "Raw API response: $response_body"
        fi

        if [[ "$http_code" != "200" ]]; then
            _error "GitHub API request failed with status $http_code"
            _error "Response: $response_body"
            return 1
        fi

        api_key=$(echo "$response_body" | jq -r '.token // empty' 2>/dev/null)

        if [[ -z "$api_key" || "$api_key" == "null" ]]; then
            _error "Failed to extract API key from response"
            _error "Response: $response_body"
            return 1
        fi

        export COPILOT_API_KEY="$api_key"
        _log "COPILOT_API_KEY successfully refreshed"

        return 0
    }
    
    # Main execution
    if ! _parse_arguments "$@"; then
        return 1
    fi
    
    _log "Starting $FUNCTION_NAME"
    
    if ! _check_dependencies; then
        return 1
    fi
    
    if [[ "$force_refresh" == true ]]; then
        need_refresh=true
    elif ! _is_token_valid; then
        need_refresh=true
    fi

    if [[ "$need_refresh" == true ]]; then
        if ! _refresh_api_key; then
            _error "Failed to refresh API key"
            return 1
        fi
    else
        _log "Current token is still valid, no refresh needed"
    fi
    
    _log "$FUNCTION_NAME completed successfully"
    return 0
}
