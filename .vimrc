" VIMRC-Help
" - Search for help:    		:h <command>
" - Browse through commends:	:options (search with /)

" GENERAL OPTIONS
" ------------------------------------------------------
set nocompatible "do not behave very Vi compatible 
set noerrorbells "no ring the bell for error messages
set visualbell "use a visual bell instead of beeping
set wildmenu "command-line completion shows a list of matches
set encoding=utf-8 "character encoding used in Vim
set backspace=indent,eol,start "Allow backspacing over autoindent, line breaks and start of insert action
let mapleader = " "
filetype indent plugin on

" OPTION FOR THE UI
" ------------------------------------------------------
syntax on "name of syntax highlighting used
colorscheme murphy
set number "show the line number for each line
set relativenumber "show the relative line number for each line
set ruler "show cursor position below each window
set nowrap "no long lines wrap
set hidden "don't unload a buffer when no longer shown in a window
set colorcolumn=80 "columns to highlight
set showmatch "when inserting a bracket, briefly jump to its match
set matchpairs+=<:> "list of pairs that match for the % command
set cmdheight=2 "number of lines used for the command-line
set laststatus=2 "0, 1 or 2; when to use a status line for the last window
set showcmd "show (partial) command keys in the status line
set scrolloff=5 "number of screen lines to show around the cursor

" NETRW DIRECTORY MANAGER
" ------------------------------------------------------
let g:netrw_banner = 0 "hide banner
let g:netrw_liststyle = 3 "view as tree
let g:netrw_browse_split = 4 "open file in previous window
let g:netrw_altv = 1
let g:netrw_winsize = 25 "width of file browser

" TABS AND INDENTATIONS
" ------------------------------------------------------
set tabstop=4 "number of spaces a <Tab> in the text stands for
set softtabstop=4 "if non-zero, number of spaces to insert for a <Tab>
set shiftwidth=4 "number of spaces used for each step of (auto)indent
set expandtab "expand <Tab> to spaces in Insert mode
set smartindent "do clever autoindenting

" SEARCHING
" ------------------------------------------------------
set ignorecase "ignore case when using a search pattern
"set smartcase "override 'ignorecase' when pattern has upper case characters
set incsearch "show match for partly typed search command
set hlsearch "highlight all matches for the last used search pattern

" MAKROS
" ------------------------------------------------------
set lazyredraw "don't redraw while executing macros

" HISTORY
" ------------------------------------------------------
set noswapfile
set nobackup
set undodir=~/.vim/undodir
set undofile
set undolevels=10000

" MAPPINGS
" ------------------------------------------------------
"copy to end of line
map Y y$ 
"rerun last macro
nnoremap Q @@ 

" Quickly insert an empty new line without entering insert mode
nnoremap <Leader>o o<Esc>0D
nnoremap <Leader>O O<Esc>0D

" copy from os clipboard
nmap <leader>y "+y
nmap <leader>yy "+yy

" paste from OS clipboard
nmap <leader>p "+p
nmap <leader>P "+P

" Commands for split view
nnoremap <leader>s <C-w>s
nnoremap <leader>v <C-w>v
nnoremap <leader>c <C-w>c
nnoremap <leader>h <C-w>h
nnoremap <leader>j <C-w>j
nnoremap <leader>k <C-w>k
nnoremap <leader>l <C-w>l

nnoremap <leader>; A;<Esc>
nnoremap <leader>, A,<Esc>

"Map <C-L> (redraw screen) to also turn off search hightlighting until next search
nnoremap <leader>/ :nohl<CR><C-L> 

function! DoPrettyXML()
  " save the filetype so we can restore it later
  let l:origft = &ft
  set ft=
  " delete the xml header if it exists. This will
  " permit us to surround the document with fake tags
  " without creating invalid xml.
  1s/<?xml .*?>//e
  " insert fake tags around the entire document.
  " This will permit us to pretty-format excerpts of
  " XML that may contain multiple top-level elements.
  0put ='<PrettyXML>'
  $put ='</PrettyXML>'
  silent %!xmllint --format -
  " xmllint will insert an <?xml?> header. it's easy enough to delete
  " if you don't want it.
  " delete the fake tags
  2d
  $d
  " restore the 'normal' indentation, which is one extra level
  " too deep due to the extra tags we wrapped around the document.
  silent %<
  " back to home
  1
  " restore the filetype
  exe "set ft=" . l:origft
endfunction
command! PrettyXML call DoPrettyXML()
