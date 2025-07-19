export AICHAT_CONFIG_DIR="$HOME/.config/aichat"


aichat() {
    set-copilot-api-key
    command aichat "$@"
}
