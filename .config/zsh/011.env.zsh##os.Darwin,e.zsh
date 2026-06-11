PATH="/opt/homebrew/opt/trash-cli/bin:$PATH"

# Herd injected PHP binary.
PATH="$HOME/Library/Application Support/Herd/bin/":$PATH
export HERD_PHP_85_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/85/"
export HERD_PHP_84_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/84/"
export HERD_PHP_83_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/83/"
export HERD_PHP_74_INI_SCAN_DIR="$HOME/Library/Application Support/Herd/config/php/74/"

export PATH

: "${GEMINI_API_KEY:=op://Private/GEMINI_API_KEY/password}"
export GEMINI_API_KEY
: "${KARAKEEP_HOST:=op://Private/Karakeep/Host}"
export KARAKEEP_HOST
: "${KARAKEEP_TOKEN:=op://Private/Karakeep/password}"
export KARAKEEP_TOKEN
: "${TASKSERVER_HOST:=op://Private/Taskwarrior/Host}"
export TASKSERVER_HOST
: "${TASKSERVER_ENCRYPTION_SECRET:=op://Private/Taskwarrior/Secret}"
export TASKSERVER_ENCRYPTION_SECRET
: "${TASKSERVER_CLIENT_ID:=op://Private/Taskwarrior/ClientId}"
export TASKSERVER_CLIENT_ID


