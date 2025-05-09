function run-repo(){
  if [[ $# -eq 0 ]]; then
    echo "Usage: $0 <command> [args...]"
    exit 1
  fi

  COMMAND=("$@")

  for sub_dir in "$REPO_PATH/*"; do
    if [[ -d $sub_dir ]]; then
      echo "Running '${COMMAND[@]}' in $sub_dir"
      (cd "$sub_dir" && "${COMMAND[@]}")
      if [[ $? -ne 0 ]]; then
        echo "Command failed in $sub_dir"
      fi
    fi
  done
}
