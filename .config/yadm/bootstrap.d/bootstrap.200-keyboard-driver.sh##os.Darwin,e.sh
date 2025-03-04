#!/bin/bash

# URL
URL="https://github.com/pqrs-org/Karabiner-DriverKit-VirtualHIDDevice/raw/refs/heads/main/dist/Karabiner-DriverKit-VirtualHIDDevice-5.0.0.pkg"

# Extract the file name from the URL
FILENAME=$(basename "$URL")

# Set download directory and file path
DOWNLOAD_DIR="$HOME/Downloads"
PKG_PATH="$DOWNLOAD_DIR/$FILENAME"

# Step 1: Download the pkg file
echo "Downloading $FILENAME to $DOWNLOAD_DIR..."
curl -L "$URL" -o "$PKG_PATH"

if [[ $? -ne 0 ]]; then
  echo "Error: Failed to download $FILENAME."
  exit 1
fi

# Step 2: Prompt user to install the pkg manually
echo "The package has been downloaded to $PKG_PATH."
echo "Please install it manually by double-clicking the file."
read -p "Once you have installed the package, press Enter to confirm or type 'quit' to cancel: " CONFIRMATION

if [[ "$CONFIRMATION" == "quit" ]]; then
  echo "Installation was canceled by the user. Exiting."
  exit 1
fi

# Step 3: Remove the pkg file
echo "Removing $FILENAME from $DOWNLOAD_DIR..."
rm -f "$PKG_PATH"

if [[ $? -eq 0 ]]; then
  echo "Done! $FILENAME has been removed after manual installation."
else
  echo "Warning: Failed to remove $FILENAME from $DOWNLOAD_DIR."
fi

/Applications/.Karabiner-VirtualHIDDevice-Manager.app/Contents/MacOS/Karabiner-VirtualHIDDevice-Manager activate
