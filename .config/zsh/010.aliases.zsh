alias cat='bat'
alias lg='lazygit'
alias lzg='lazygit'
alias lzd='lazydocker'
alias ylg='lazygit --git-dir ~/.local/share/yadm/repo.git/'
alias ynvim='yadm enter nvim ~'
alias diff='delta -n -s'
alias rm='trash-put'

alias wiki='nvim $WIKI_HOME/index.md'
alias daily='nvim +Obsidian\ today'
alias wikisync='gitsync $WIKI_HOME'

# AI related stuff
alias ai='CC_LAYOUT_OVERRIDE=buffer nvim +"CodeCompanionChat Toggle"'
alias mcp='nvim +"MCPHub"'
alias update-copilot-instructions='cp /home/vimateck/Development/Repos/Notes/p0-rules.instructions.md /mnt/c/Users/vimateck/AppData/Roaming/Code/User/prompts/'

# debian specific
alias "map-esc"='setxkbmap -option caps:escape'

# Mac specific
alias icloud='cd ~/Library/Mobile\ Documents/com~apple~CloudDocs'

# dotnet specific
alias outdated='dotnet outdated -exc Roslynator -exc CSharpier'

# General alias
alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'

# Global alias
alias -g C='| pbcopy'
alias -g G='| grep'
alias -g L='| less'
alias -g S='| sort -h'
alias -g J='| jq'
alias -g W='| wc -l'
alias -g NE='2>/dev/null'
alias -g DN='>/dev/null'
alias -g NUL='>/dev/null 2>&1'
