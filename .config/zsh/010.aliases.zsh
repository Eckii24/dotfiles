alias cat='bat'
alias lg='lazygit'
alias lzd='lazydocker'
alias ylg='lazygit --git-dir ~/.local/share/yadm/repo.git/'
alias ynvim='yadm enter nvim ~'
alias 1nvim='OM nvim'
alias diff='delta -n -s'
alias rm='trash-put'

alias wiki='(cd $WIKI_HOME; nvim $WIKI_HOME/index.md)'
alias daily='(cd $WIKI_HOME; nvim +Obsidian\ today)'
alias tomorrow='(cd $WIKI_HOME; nvim +Obsidian\ tomorrow)'
alias wikisync='gitsync $WIKI_HOME'
alias tasksync='gitsync $TASKDATA'
alias allsync='wikisync && tasksync'

# AI related stuff
alias db='OM nvim +"DBUI"'
alias ado-deployments='OM ado-deployments'

# debian specific
alias "map-esc"='setxkbmap -option caps:escape'

# Mac specific
alias icloud='cd ~/Library/Mobile\ Documents/com~apple~CloudDocs'

# General alias
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

# Global alias
alias -g C='| pbcopy'
alias -g G='| rg'
alias -g L='| less'
alias -g S='| sort -h'
alias -g J='| jq'
alias -g W='| wc -l'
alias -g NE='2>/dev/null'
alias -g DN='>/dev/null'
alias -g NUL='>/dev/null 2>&1'
alias -g O='op run --'
alias -g OM='op run --no-masking --'

Oz() {
  if [[ $# -eq 0 ]]; then
    echo 'Usage: Oz <command string or args...>' >&2
    return 1
  fi

  op run -- zsh -ic "$*"
}

OMz() {
  if [[ $# -eq 0 ]]; then
    echo 'Usage: OMz <command string or args...>' >&2
    return 1
  fi

  op run --no-masking -- zsh -ic "$*"
}
