function zellij-da() {
  # Start the zellij daemon
  zellij da -y

  # Iterate over the output of `zellij ls`
  zellij ls | while read -r line; do
  # Extract the first and second parts of the line
  first_part=$(echo "$line" | awk '{print $1}' | xargs)
  second_part=$(echo "$line" | awk '{print $2}')

  if [[ "$second_part" != *"current"* ]]; then
    # Execute the zellij delete command with --force
    zellij d --force $first_part
  fi
done
}
