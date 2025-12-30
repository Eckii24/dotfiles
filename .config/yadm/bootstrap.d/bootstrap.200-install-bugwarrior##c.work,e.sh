# Install bugwarrior and dependencies in a virtual environment under $HOME/.local

VENV_DIR="$HOME/.local/venv"
BIN_DIR="$HOME/.local/bin"

# Ensure necessary directories exist
mkdir -p "$HOME/.local" "$BIN_DIR"

# Create or recreate virtual environment
if [ -d "$VENV_DIR" ]; then
  rm -rf "$VENV_DIR"
fi
python3 -m venv "$VENV_DIR"

# Upgrade pip/setuptools and install bugwarrior inside the venv
"$VENV_DIR/bin/pip" install --upgrade pip setuptools
"$VENV_DIR/bin/pip" install bugwarrior

# Create symlink to make bugwarrior globally accessible
ln -sf "$VENV_DIR/bin/bugwarrior" "$BIN_DIR/bugwarrior"

# Enable automatic pulling of updates via cron (use full path so cron can run it)
CRON_ENTRY="0 */2 * * * $BIN_DIR/bugwarrior pull"

# List current crontab to temp file
crontab -l >/tmp/current_cron 2>/dev/null

# Grep for the entry; add if missing
if ! grep -Fxq "$CRON_ENTRY" /tmp/current_cron; then
  echo "$CRON_ENTRY" >>/tmp/current_cron
  crontab /tmp/current_cron
  echo "Crontab entry added."
else
  echo "Crontab entry already exists."
fi

# Optional cleanup
rm -f /tmp/current_cron
