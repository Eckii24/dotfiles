alias cat='bat'
alias lg='lazygit'
alias lzg='lazygit'
alias lzd='lazydocker'
alias ylg='lazygit --git-dir ~/.local/share/yadm/repo.git/'
alias ynvim='yadm enter nvim ~'
alias diff='delta -n -s'
alias rm='trash-put'

# AI Neovim with CodeCompanion chat in buffer layout
alias ai='CC_LAYOUT_OVERRIDE=buffer nvim +"CodeCompanionChat Toggle"'

# debian specific
alias "map-esc"='setxkbmap -option caps:escape'

# Mac specific
alias mitmweb='docker run -it --rm -v ~/.mitmproxy:/home/mitmproxy/.mitmproxy -p 8080:8080 -p 127.0.0.1:8081:8081 mitmproxy/mitmproxy mitmweb --web-host 0.0.0.0'
alias icloud='cd ~/Library/Mobile\ Documents/com~apple~CloudDocs'
