
alias pi-read='pi --tools read,grep,find,ls'

pi-chat() {
  local settings_file="$HOME/.pi/agent/settings.json"
  local model="github-copilot/gpt-5-mini"
  local prompt=""
  local resolved_prompt=""
  local prompt_path=""
  local prompt_candidate=""
  local search_dir=""
  local prompt_name=""
  local prompt_file=""
  local settings_chat_model=""
  local settings_default_provider=""
  local -a passthrough=()

  if [[ -f "$settings_file" ]] && command -v jq >/dev/null 2>&1; then
    settings_chat_model="$(jq -r '.chatModel // empty' "$settings_file" 2>/dev/null)"
    settings_default_provider="$(jq -r '.defaultProvider // empty' "$settings_file" 2>/dev/null)"
    [[ -n "$settings_chat_model" ]] && model="$settings_chat_model"
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --prompt|-p)
        if (( $# < 2 )); then
          echo "pi-chat: missing value for $1" >&2
          return 1
        fi
        prompt="$2"
        shift 2
        ;;
      --prompt=*)
        prompt="${1#--prompt=}"
        shift
        ;;
      --model|-m)
        if (( $# < 2 )); then
          echo "pi-chat: missing value for $1" >&2
          return 1
        fi
        model="$2"
        shift 2
        ;;
      --model=*)
        model="${1#--model=}"
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage: pi-chat [options] [-- <pi args>]

Options:
  -p, --prompt PROMPT  Prompt text or prompt name; prepended to system prompt
  -m, --model MODEL    Model to use; bare IDs resolve through settings.json defaultProvider
                       (default: settings.json chatModel or github-copilot/gpt-5-mini)
  -h, --help           Show this help

Prompt resolution:
  - PROMPT with spaces/newlines -> literal prompt text
  - PROMPT without spaces -> prompt lookup name
  - Lookup order: ./.pi/agent/prompts, ./.pi/prompts, parent dirs, then ~/.pi/agent/prompts
  - Supported files: <name>, <name>.md, <name>.markdown
  - Named prompt missing everywhere -> error

Always runs Pi in non-interactive print mode with -p --no-tools.
Any remaining arguments are passed through to pi.
EOF
        return 0
        ;;
      --)
        shift
        passthrough+=("$@")
        break
        ;;
      *)
        passthrough+=("$1")
        shift
        ;;
    esac
  done

  if [[ "$model" != */* ]] && [[ -n "$settings_default_provider" ]]; then
    model="$settings_default_provider/$model"
  fi
  local -a pi_args=(--model "$model")

  if [[ -n "$prompt" ]]; then
    prompt_candidate="$prompt"

    if [[ "$prompt_candidate" == @* ]]; then
      prompt_candidate="${prompt_candidate#@}"
      if [[ ! -f "$prompt_candidate" ]]; then
        echo "pi-chat: prompt file not found: $prompt_candidate" >&2
        return 1
      fi
      prompt_path="$prompt_candidate"
    elif [[ -f "$prompt_candidate" ]]; then
      prompt_path="$prompt_candidate"
    elif [[ "$prompt_candidate" == *[[:space:]]* ]]; then
      resolved_prompt="$prompt"
    else
      search_dir="$PWD"
      while :; do
        for prompt_name in "$prompt_candidate" "${(L)prompt_candidate}"; do
          for prompt_file in \
            "$search_dir/.pi/agent/prompts/$prompt_name" \
            "$search_dir/.pi/agent/prompts/$prompt_name.md" \
            "$search_dir/.pi/agent/prompts/$prompt_name.markdown" \
            "$search_dir/.pi/prompts/$prompt_name" \
            "$search_dir/.pi/prompts/$prompt_name.md" \
            "$search_dir/.pi/prompts/$prompt_name.markdown"; do
            if [[ -f "$prompt_file" ]]; then
              prompt_path="$prompt_file"
              break 3
            fi
          done
        done

        [[ "$search_dir" == "/" ]] && break
        search_dir="${search_dir:h}"
      done

      if [[ -z "$prompt_path" ]]; then
        for prompt_name in "$prompt_candidate" "${(L)prompt_candidate}"; do
          for prompt_file in \
            "$HOME/.pi/agent/prompts/$prompt_name" \
            "$HOME/.pi/agent/prompts/$prompt_name.md" \
            "$HOME/.pi/agent/prompts/$prompt_name.markdown"; do
            if [[ -f "$prompt_file" ]]; then
              prompt_path="$prompt_file"
              break 2
            fi
          done
        done
      fi

      if [[ -z "$prompt_path" ]]; then
        echo "pi-chat: prompt '$prompt_candidate' not found in project or ~/.pi/agent/prompts" >&2
        return 1
      fi
    fi

    [[ -n "$prompt_path" ]] && resolved_prompt="$(<"$prompt_path")"

    command pi -p --no-tools --no-extensions "${pi_args[@]}" --append-system-prompt "$resolved_prompt" "${passthrough[@]}"
    return
  fi

  command pi -p --no-tools --no-extensions "${pi_args[@]}" "${passthrough[@]}"
}
