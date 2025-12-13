uv venv --clear
uv pip install tasklib
uv pip install pynvim
uv pip install six
uv pip install packaging

# Ensure 'task' command exists
if ! command -v task >/dev/null 2>&1; then
  brew install task@2 -f
  ln -fs "$HOMEBREW_PREFIX/opt/task@2/bin/task" "$HOME/.local/bin/task"
fi
