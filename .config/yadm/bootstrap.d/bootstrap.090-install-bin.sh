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
# Create a temporary file for the downloaded binary and ensure it is removed on exit
BIN_TMP="$(mktemp "/tmp/bin.XXXXXXXX")"
trap 'rm -f "$BIN_TMP"' EXIT

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
# Asset pattern includes version, e.g., bin_0.24.2_darwin_arm64
ASSET_PATTERN="bin_.*_${OS}_${ARCH}"

echo "Querying GitHub API for latest release asset matching ${ASSET_PATTERN}..."
API_JSON=$(curl -fsSL "https://api.github.com/repos/marcosnils/bin/releases/latest") || {
	echo "Failed to fetch release metadata from GitHub"
	exit 1
}
DOWNLOAD_URL=$(printf "%s" "$API_JSON" | grep -Eo '"browser_download_url":\s*"[^"]+"' | sed -E 's/.*"([^"]+)".*/\1/' | grep -E "$ASSET_PATTERN" | head -n1 || true)
if [ -z "$DOWNLOAD_URL" ]; then
	echo "Could not find a release asset matching $ASSET_PATTERN"
	exit 1
fi

echo "Downloading $DOWNLOAD_URL"
curl -fSL "$DOWNLOAD_URL" -o "$BIN_TMP" || {
	echo "Failed to download asset from $DOWNLOAD_URL"
	exit 1
}

chmod +x "$BIN_TMP"

# Install bin (self-managed). This will place the installed binary into
# the configured default_path (see config.json created above).
"$BIN_TMP" install github.com/marcosnils/bin

# Smoke test (use the just-installed bin)
"$BIN_DEST_DIR/bin" ls
