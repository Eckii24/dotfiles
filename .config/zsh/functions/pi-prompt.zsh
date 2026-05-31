_pi_normalize_model() {
  local model="$1"

  case "$model" in
    copilot:*) print -r -- "github-copilot/${model#copilot:}" ;;
    github-copilot:*) print -r -- "github-copilot/${model#github-copilot:}" ;;
    azure:*) print -r -- "github-copilot/${model#azure:}" ;;
    *) print -r -- "$model" ;;
  esac
}

_pi_prompt_file_for_role() {
  local role="$1"
  local prompt_file="$HOME/.pi/agent/prompts/${role}.md"

  [[ -f "$prompt_file" ]] || return 1
  print -r -- "$prompt_file"
}

_pi_print() {
  local model="$1"
  shift

  local -a pi_args=(-p --no-tools)
  if [[ -n "$model" ]]; then
    pi_args+=(--model "$(_pi_normalize_model "$model")")
  fi

  if functions set-copilot-api-key >/dev/null 2>&1; then
    set-copilot-api-key
  fi

  command pi "${pi_args[@]}" "$@"
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
