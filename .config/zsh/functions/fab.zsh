function fab() {
  local model="gpt-4o"
  local params=()
  while (( "$#" )); do
    case "$1" in
      -m|--model)
        model="$2"
        shift 2
        ;;
      *)
        params+=("$1")
        shift
        ;;
    esac
  done

  local extra_params=()
  case "$model" in
    o1|o1-mini|o3|o3-mini|o4-mini)
      extra_params=(-t 1 -T 1)
      ;;
  esac
  fabric -m "$model" "${extra_params[@]}" "${params[@]}"
}
