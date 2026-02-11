omo() {
    local config_file="$HOME/.config/opencode/opencode.json"
    local updated_json
    
    # Read and update the JSON:
    # - Create plugin array if it doesn't exist
    # - Add "oh-my-opencode" only if not already present
    updated_json=$(jq '.plugin = (.plugin // [] | if index("oh-my-opencode") then . else . + ["oh-my-opencode"] end)' "$config_file")
    
    # Execute opencode with the updated config as environment variable
    OPENCODE_CONFIG_CONTENT="$updated_json" opencode "$@"
}

replace-opencode-ghe(){
  local opencode_bin="$HOME/.opencode/bin/opencode"

  # Backup the original binary
  cp $opencode_bin "$opencode_bin.bak"

  # Patch the ID
  perl -pi -e 's/Ov23li8tweQw6odWQebz/Ov23ctDVkRmgkPke0Mmm/g' "$opencode_bin"

  # Re-sign the binary (Crucial on macOS!)
  sudo codesign --force --deep --sign - "$opencode_bin"
}
