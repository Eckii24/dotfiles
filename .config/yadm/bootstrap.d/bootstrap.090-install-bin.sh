#!/bin/bash

set -eu

BIN_DEST_DIR="$HOME/.local/bin"
BIN_TMP="/tmp/bin"

BIN_CONFIG_DIR="$HOME/.config/bin"
BIN_CONFIG_FILE="$BIN_CONFIG_DIR/config.json"

mkdir -p "$BIN_CONFIG_DIR"

# Ensure config exists with expanded $HOME path (bin does not expand it)
if [ ! -f "$BIN_CONFIG_FILE" ]; then
	echo "Creating minimal bin config at $BIN_CONFIG_FILE"
	echo "{ \"default_path\": \"$HOME/.local/bin\", \"bins\": { } }" >"$BIN_CONFIG_FILE"
fi

if command -v bin &>/dev/null; then
	echo "bin is already installed. Skipping installation."
	exit 0
fi

echo "bin is not installed. Installing now..."

# Download latest release binary to /tmp and use it once to install bin.
# README flow:
#   1) download bin from releases
#   2) run ./bin install github.com/marcosnils/bin
curl -fsSL "https://github.com/marcosnils/bin/releases/latest/download/bin_$(uname -s)_$(uname -m)" -o "$BIN_TMP"
chmod +x "$BIN_TMP"

# Install bin (self-managed). This will place the installed binary into
# the configured default_path (see config.json created above).
"$BIN_TMP" install github.com/marcosnils/bin

# Smoke test (use the just-installed bin)
"$BIN_DEST_DIR/bin" ls
