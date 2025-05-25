function zellij-da() {
  # Delete sessions with board utilities
  zellij da -y

  # Delete remaining sessions
  zellij ls -n | while read -r line; do
    first_part=$(echo "$line" | awk '{print $1}' )

    if [[ ! "$line" == *current* ]]; then
      # Execute the zellij delete command with --force
      zellij d --force $first_part
    fi
  done
}

