#!/bin/bash

set -eu

plugin_dir="$HOME/.config/herdr/plugins/local/workspace-memo"

if ! command -v herdr >/dev/null 2>&1; then
  echo "Herdr is not installed; skip workspace-memo plugin link."
  exit 0
fi

if [ ! -f "$plugin_dir/herdr-plugin.toml" ]; then
  echo "Workspace-memo plugin source is absent; skip plugin link."
  exit 0
fi

plugins="$(herdr plugin list 2>/dev/null || true)"
case "$plugins" in
  *"matthias.workspace-memo"*)
    echo "Workspace-memo plugin is already linked."
    exit 0
    ;;
esac

herdr plugin link "$plugin_dir"
