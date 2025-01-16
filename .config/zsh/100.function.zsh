function init-pre-commit() {
    pre-commit install -c ~/.config/git/pre-commit-config.yaml -t pre-commit -t pre-push -f
}

alias pc="init-pre-commit"
