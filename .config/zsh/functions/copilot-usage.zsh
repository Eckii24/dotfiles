# GitHub Copilot Usage
# Fetches and pretty prints the current GitHub Copilot premium request usage

copilot-usage() {
    local -r FUNCTION_NAME="copilot-usage"
    local -r APPS_JSON_PATH="$HOME/.config/github-copilot/apps.json"

    local verbose=false
    local json_output=false

    _log()   { [[ "$verbose" == true ]] && echo "[$FUNCTION_NAME] $1" >&2; }
    _error() { echo "[$FUNCTION_NAME] ERROR: $1" >&2; }

    _show_help() {
        cat << EOF
Usage: $FUNCTION_NAME [OPTIONS]

Fetches and pretty prints the current GitHub Copilot premium request usage
for the billing period.

OPTIONS:
    -v, --verbose   Enable verbose output
    -j, --json      Output raw JSON response instead of pretty print
    -h, --help      Show this help message

DESCRIPTION:
    Reads the OAuth token from ~/.config/github-copilot/apps.json and
    calls the GitHub Copilot quota API to display used / remaining /
    total premium requests, a progress bar, a simple linear month-end
    forecast, and the next reset date.
EOF
    }

    # ---------------------------------------------------------------------------
    # Argument parsing
    # ---------------------------------------------------------------------------
    while [[ "$#" -gt 0 ]]; do
        case "$1" in
            -v|--verbose) verbose=true; shift ;;
            -j|--json)    json_output=true; shift ;;
            -h|--help)    _show_help; return 0 ;;
            *)
                _error "Unknown argument: $1"
                _show_help
                return 1
                ;;
        esac
    done

    # ---------------------------------------------------------------------------
    # Dependency check
    # ---------------------------------------------------------------------------
    local missing_deps=()
    command -v jq   >/dev/null 2>&1 || missing_deps+=("jq")
    command -v curl >/dev/null 2>&1 || missing_deps+=("curl")

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        _error "Missing required dependencies: ${missing_deps[*]}"
        return 1
    fi

    # ---------------------------------------------------------------------------
    # Read OAuth token from apps.json (same source as set-copilot-api-key)
    # ---------------------------------------------------------------------------
    if [[ ! -f "$APPS_JSON_PATH" ]]; then
        _error "GitHub Copilot config not found: $APPS_JSON_PATH"
        _error "Please ensure GitHub Copilot is properly configured."
        return 1
    fi

    local first_key domain oauth_token
    first_key=$(jq -r 'keys[0]' "$APPS_JSON_PATH" 2>/dev/null)

    if [[ -z "$first_key" || "$first_key" == "null" ]]; then
        _error "No entries found in $APPS_JSON_PATH"
        return 1
    fi

    # Key format: "<domain>:<some-id>"
    domain="${first_key%%:*}"
    oauth_token=$(jq -r --arg key "$first_key" '.[$key].oauth_token' "$APPS_JSON_PATH" 2>/dev/null)

    if [[ -z "$oauth_token" || "$oauth_token" == "null" ]]; then
        _error "Failed to extract OAuth token from $APPS_JSON_PATH"
        return 1
    fi

    _log "GitHub domain: $domain"

    # ---------------------------------------------------------------------------
    # Build quota API URL (GitHub.com vs. GitHub Enterprise)
    # ---------------------------------------------------------------------------
    local api_url
    if [[ "$domain" == "github.com" ]]; then
        api_url="https://api.github.com/copilot_internal/user"
    else
        api_url="https://${domain}/api/v3/copilot_internal/user"
    fi
    _log "API URL: $api_url"

    # ---------------------------------------------------------------------------
    # Fetch usage from the quota endpoint
    # ---------------------------------------------------------------------------
    local curl_response http_code response_body
    curl_response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $oauth_token" \
        -H "Accept: application/json" \
        -H "User-Agent: copilot-usage-zsh" \
        "$api_url" 2>/dev/null)

    http_code="${curl_response##*$'\n'}"
    response_body="${curl_response%$'\n'*}"

    _log "HTTP status: $http_code"

    if [[ "$http_code" != "200" ]]; then
        _error "API request failed with HTTP $http_code"
        _error "Response: $response_body"
        return 1
    fi

    # ---------------------------------------------------------------------------
    # Raw JSON mode
    # ---------------------------------------------------------------------------
    if [[ "$json_output" == true ]]; then
        echo "$response_body" | jq .
        return 0
    fi

    # ---------------------------------------------------------------------------
    # Parse usage fields
    # ---------------------------------------------------------------------------
    local entitlement remaining unlimited reset_date
    entitlement=$(echo "$response_body" | jq -r '.quota_snapshots.premium_interactions.entitlement // 0')
    remaining=$(echo "$response_body"   | jq -r '.quota_snapshots.premium_interactions.remaining   // 0')
    unlimited=$(echo "$response_body"   | jq -r '.quota_snapshots.premium_interactions.unlimited   // false')
    reset_date=$(echo "$response_body"  | jq -r '.quota_reset_date // .quota_reset_date_utc // "unknown"')

    local used=0 pct=0
    local current_day=0 days_in_month=0
    local projected_used=0 projected_pct=0 projected_delta=0
    if [[ "$unlimited" != "true" ]]; then
        used=$(( entitlement - remaining ))
        [[ $used -lt 0 ]] && used=0
        [[ $entitlement -gt 0 ]] && pct=$(( used * 100 / entitlement ))

        current_day=$(( 10#$(date "+%d") ))
        if date -v1d >/dev/null 2>&1; then
            days_in_month=$(( 10#$(date -v1d -v+1m -v-1d "+%d") ))
        else
            days_in_month=$(( 10#$(date -d "$(date "+%Y-%m-01") +1 month -1 day" "+%d") ))
        fi
        if [[ $current_day -gt 0 ]]; then
            projected_used=$(( (used * days_in_month + (current_day / 2)) / current_day ))
            [[ $entitlement -gt 0 ]] && projected_pct=$(( projected_used * 100 / entitlement ))
            projection_delta=$(( projected_used - entitlement ))
        fi
    fi

    # ---------------------------------------------------------------------------
    # Build progress bar (30 chars wide)
    # ---------------------------------------------------------------------------
    local bar_width=30 filled=0 empty=$bar_width
    if [[ "$unlimited" != "true" && $entitlement -gt 0 ]]; then
        filled=$(( used * bar_width / entitlement ))
        empty=$(( bar_width - filled ))
    fi

    local bar="" i
    for (( i = 0; i < filled; i++ )); do bar+="█"; done
    for (( i = 0; i < empty;  i++ )); do bar+="░"; done

    # ---------------------------------------------------------------------------
    # Pick a color based on consumption percentage
    # ---------------------------------------------------------------------------
    local c_reset="\033[0m"
    local c_label="\033[1m"           # bold for labels
    local c_dim="\033[2m"
    local c_usage c_projection
    if   [[ $pct -ge 90 ]]; then c_usage="\033[0;31m"   # red
    elif [[ $pct -ge 70 ]]; then c_usage="\033[0;33m"   # yellow
    else                          c_usage="\033[0;32m"   # green
    fi

    if   [[ $projected_pct -ge 100 ]]; then c_projection="\033[0;31m"
    elif [[ $projected_pct -ge 90 ]]; then c_projection="\033[0;33m"
    else                                    c_projection="\033[0;32m"
    fi

    # ---------------------------------------------------------------------------
    # Pretty print
    # ---------------------------------------------------------------------------
    echo ""
    printf "  ${c_label}GitHub Copilot — Premium Request Usage${c_reset}\n"
    printf "  ${c_dim}%s${c_reset}\n" "──────────────────────────────────────────"

    if [[ "$unlimited" == "true" ]]; then
        printf "  %-14s %s\n" "Plan:" "Unlimited ∞"
        printf "  ${c_dim}No usage limits apply to your current plan.${c_reset}\n"
    else
        printf "  %-14s ${c_usage}%d / %d${c_reset} requests\n" "Used:" "$used" "$entitlement"
        printf "  %-14s ${c_usage}%d${c_reset} requests\n"      "Remaining:" "$remaining"
        printf "  %-14s [${c_usage}%s${c_reset}] ${c_usage}%d%%${c_reset}\n" "Progress:" "$bar" "$pct"
        printf "  %-14s %s\n"                                    "Resets on:" "$reset_date"

        if [[ $projection_delta -gt 0 ]]; then
            printf "  %-14s ${c_projection}%d${c_reset} requests ${c_dim}(%s${c_projection}+%d${c_reset}${c_dim})${c_reset}\n" "Forecast:" "$projected_used" "over: " "$projection_delta"
        else
            printf "  %-14s ${c_projection}%d${c_reset} requests ${c_dim}(%s${c_projection}%d${c_reset}${c_dim})${c_reset}\n" "Forecast:" "$projected_used" "left: " "$(( -projection_delta ))"
        fi
    fi

    echo ""
    return 0
}
