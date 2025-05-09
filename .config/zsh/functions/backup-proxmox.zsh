function backup-proxmox() {
  # Source and destination paths
  SOURCE_PATH="proxmox:/var/lib/vz/dump"
  DESTINATION_PATH="/Users/matthiaseck/Library/Mobile Documents/com~apple~CloudDocs/Backups/proxmox"

  # Copy files starting with "vzdump-lxc-102" using scp
  scp "$SOURCE_PATH"/vzdump-lxc-102\* "$DESTINATION_PATH" && \

  # If scp command is successful, delete older files from the destination path
  find "$DESTINATION_PATH" -maxdepth 1 -type f -name 'vzdump-lxc-102*' -mtime +7 -exec rm {} \;
}
