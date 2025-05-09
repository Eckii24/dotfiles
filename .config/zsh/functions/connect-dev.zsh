function connect-dev() {

  if [[ -n "$ZELLIJ_SESSION_NAME" ]]; then
    vared -p "Zellij session detected. Start the container inside the current session? (y/n): " -c answer
    if [[ "$answer" != "y" ]]; then
      echo "Aborting connection."
      return 1
    fi
  fi

  local port=2222
  local identity=""

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --port|-p)
        port="$2"
        shift 2
        ;;
      --identity|-i)
        identity="-i $2"
        shift 2
        ;;
      *)
        echo "Unknown option: $1"
        return 1
        ;;
    esac
  done

  # Check if the port is already in use
  if ! lsof -i:$port > /dev/null; then
    vared -p "Port $port is not in use. Do you want to start the development container? (y/n): " -c answer
    if [[ "$answer" == "y" ]]; then
      start-dev -p $port
      sleep 3
    else
      echo "Aborting connection."
      return 1
    fi
  fi

  # Construct and execute SSH command
  local ssh_cmd="ssh -p $port root@localhost -A $identity"
  echo "Executing: $ssh_cmd"
  eval "$ssh_cmd"
}
