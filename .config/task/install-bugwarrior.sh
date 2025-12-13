# Install bugwarrior and dependencies in a virtual environment
uv venv --clear
uv pip install bugwarrior
uv pip install setuptools

# Create symlink to make bugwarrior globally accessible
ln -sf $PWD/.venv/bin/bugwarrior $HOME/.local/bin/bugwarrior

# Enable automatic pulling of updates via cron
CRON_ENTRY="0 */2 * * * bugwarrior pull"

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

rm /tmp/current_cron # Optional cleanup
