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

# Use provided crontab block for bugwarrior (keeps user-specified environment)
CRON_BLOCK="$(
  cat <<'CRON'
BUGWARRIORRC="/home/vimateck/.config/task/bugwarrior.toml"
TASKRC="/home/vimateck/.config/task/taskrc"
TASKDATA="/home/vimateck/Development/Repos/Notes/task"

# Run `bugwarrior pull` every 15 min
*/15 * * * * bugwarrior pull
CRON
)"

# List current crontab to temp file (allow empty crontab)
crontab -l >/tmp/current_cron 2>/dev/null || true

# Remove any previous BUGWARRIOR block to avoid duplicates
sed -i '/^# BUGWARRIOR-BEGIN$/,/^# BUGWARRIOR-END$/d' /tmp/current_cron || true

# Append new block with markers
{
  printf '%s\n' "# BUGWARRIOR-BEGIN"
  printf '%s\n' "$CRON_BLOCK"
  printf '%s\n' "# BUGWARRIOR-END"
} >>/tmp/current_cron

crontab /tmp/current_cron
echo "Crontab updated."

# Optional cleanup
rm -f /tmp/current_cron
