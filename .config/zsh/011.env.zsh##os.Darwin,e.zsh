PATH="/opt/homebrew/opt/trash-cli/bin:$PATH"

# Herd injected PHP binary.
PATH="$HOME/Library/Application Support/Herd/bin/":$PATH
export HERD_PHP_84_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/84/"
export HERD_PHP_83_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/83/"
export HERD_PHP_74_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/74/"

export PATH

export GEMINI_API_KEY="op://Private/GEMINI_API_KEY/password"
export KARAKEEP_HOST="op://Private/Karakeep/Host"
export KARAKEEP_TOKEN="op://Private/Karakeep/password"
export TASKSERVER_HOST="op://Private/Taskwarrior/Host"
export TASKSERVER_ENCRYPTION_SECRET="op://Private/Taskwarrior/Secret"
export TASKSERVER_CLIENT_ID="op://Private/Taskwarrior/ClientId"

export COPILOT_BASE="githubcopilot.com"
export COPILOT_API_BASE="https://api.githubcopilot.com"
