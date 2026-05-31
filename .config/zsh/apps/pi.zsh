
alias pi-read='pi --tools read,grep,find,ls'

_pi_print() {
  local model="$1"
  shift

  local -a pi_args=(--no-tools -p)
  if [[ -n "$model" ]]; then
    pi_args+=(--model "$model")
  fi

  command pi "${pi_args[@]}" "$@"
}

_pi_prompt_file_for_role() {
  local role="$1"
  local prompt_file="$HOME/.pi/agent/prompts/${role}.md"

  [[ -f "$prompt_file" ]] || return 1
  print -r -- "$prompt_file"
}

_pi_print_role() {
  local role="$1"
  local model="$2"
  shift 2

  local prompt_file
  prompt_file="$(_pi_prompt_file_for_role "$role")" || {
    echo "Error: Pi prompt not found for role: $role" >&2
    return 1
  }

  _pi_print "$model" "@$prompt_file" "$@"
}

pi-chat() {
  local model="github-copilot/gpt-5-mini"
  local prompt=""
  local -a passthrough=()
  local -a pi_args=(--no-tools --model "$model")

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
        pi_args=(--no-tools --model "$model")
        shift 2
        ;;
      --model=*)
        model="${1#--model=}"
        pi_args=(--no-tools --model "$model")
        shift
        ;;
      --help|-h)
        cat <<'EOF'
Usage: pi-chat [options] [-- <pi args>]

Options:
  -p, --prompt PROMPT  Inject prompt and run Pi in print mode
  -m, --model MODEL    Model to use (default: gpt-5.1-mini)
  -h, --help           Show this help

Without --prompt, starts Pi with --no-tools and default model.
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

  if [[ -n "$prompt" ]]; then
    command pi -p "${pi_args[@]}" "${passthrough[@]}" "$prompt"
    return
  fi

  command pi "${pi_args[@]}" "${passthrough[@]}"
}
