function pr-text(){
  local model="gpt-4o" # Default value
  local output

  while [[ "$#" -gt 0 ]]; do
    case $1 in
      --model | -m)
        model="$2"
        shift 2
        ;;
      --output | -o)
        output="$2"
        shift 2
        ;;
      *)
        echo "Unknown parameter: $1"
        return 1
        ;;
    esac
  done

  local diff_output
  diff_output=$(git --no-pager diff $(git merge-base --fork-point master))

  if [[ -n "$output" ]]; then
    (echo "$diff_output" | fab -p write_pr -m "$model" -o "$output")
  else
    (echo "$diff_output" | fab -p write_pr -m "$model")
  fi
}
