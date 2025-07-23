function mockoon() {
  local data_file=""

  # Parse command line arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      -d|--data)
        data_file="$2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1"
        echo "Usage: mockoon [-d|--data <file>]"
        return 1
        ;;
    esac
  done

  # If data file is provided, use it directly
  if [[ -n "$data_file" ]]; then
    echo "Using provided data file: $data_file"
    mockoon-cli start --data "$data_file" --watch
    return $?
  fi

  # Find all JSON files in mock directories
  local find_result=$(find . -type d -name 'mock' -exec find {} -type f -name '*.json' \;)

  if [[ -z "$find_result" ]]; then
    echo "Error: No JSON files found in any 'mock' directories"
    return 1
  fi

  local file_count=$(echo "$find_result" | wc -l)

  if [[ $file_count -eq 1 ]]; then
    data_file="$find_result"
  else
    echo "Multiple JSON files found ($file_count files). Please select one:"
    data_file=$(echo "$find_result" | fzf --prompt="Select mock data file: " --height=10)

    if [[ -z "$data_file" ]]; then
      echo "No file selected. Exiting."
      return 1
    fi
  fi

  # Execute mockoon-cli with selected data file
  echo "Starting Mockoon with data file: $data_file"
  mockoon-cli start --data "$data_file" --watch
}

