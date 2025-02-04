" ------------------------------------------------------
" Neovim configs

let mapleader = " "
let maplocalleader = "\\"

set clipboard = "unnamedplus"
set completeopt=menu,menuone,noselect 
set conceallevel=2 " Hide * markup for bold and italic, but not markers with substitutions 
set confirm " Confirm to save changes before exiting modified buffer 
set cursorline " Enable highlighting of the current line 
set encoding=utf-8 "character encoding used in Vim
set expandtab " Use spaces instead of tabs 
set fillchars=foldopen:,foldclose:,fold: ,foldsep: ,diff:╱,eob:  
set foldlevel=99 
set formatexpr=v:lua.require'lazyvim.util'.format.formatexpr() 
set formatoptions=jcroqlnt " tcqj 
set grepformat=%f:%l:%c:%m 
set grepprg=rg\ --vimgrep 
set ignorecase " Ignore case 
set inccommand=nosplit " preview incremental substitute 
set jumpoptions=view 
set laststatus=3 " global statusline 
set lazyredraw "don't redraw while executing macros
set linebreak " Wrap lines at convenient points 
set list " Show some invisible characters (tabs... 
set matchpairs+=<:> "list of pairs that match for the % command
set mouse=a " Enable mouse mode 
set number " Print line number 
set pumblend=10 " Popup blend 
set pumheight=10 " Maximum number of entries in a popup 
set relativenumber " Relative line numbers 
set ruler=0 " Disable the default ruler 
set scrolloff=4 " Lines of context 
set sessionoptions=buffers,curdir,tabpages,winsize,help,globals,skiprtp,folds 
set shiftround " Round indent 
set shiftwidth=2 " Size of an indent 
set shortmess+=W,I,c,C 
set showmode=0 " Don't show mode since we have a statusline 
set sidescrolloff=8 " Columns of context 
set signcolumn=yes " Always show the signcolumn, otherwise it would shift the text each time 
set smartcase " Don't ignore case with capitals 
set smartindent " Insert indents automatically 
set spelllang=en 
set splitbelow " Put new windows below current 
set splitkeep=screen 
set splitright " Put new windows right of current 
set statuscolumn=%!v:lua.require'snacks.statuscolumn'.get() 
set tabstop=2 " Number of spaces tabs count for 
set termguicolors " True color support 
set timeoutlen=300 " Lower than default (1000) to quickly trigger which-key 
set undofile 
set undolevels=10000 
set updatetime=200 " Save swap file and trigger CursorHold 
set virtualedit=block " Allow cursor to move where there is no text in visual block mode 
set wildmode=longest:full,full " Command-line completion mode 
set winminwidth=5 " Minimum window width 
set wrap=0 " Disable line wrap

" MAPPINGS
" ------------------------------------------------------
"copy to end of line
map Y y$ 
"rerun last macro
nnoremap Q @@ 

" Quickly insert an empty new line without entering insert mode
nnoremap <Leader>o o<Esc>0D
nnoremap <Leader>O O<Esc>0D

" Window navigation
let g:WhichKeyDesc_windows = "<leader>w Windows"

let g:WhichKeyDesc_windows_go_left = "<C-h> Go to Left Window"
nnoremap <C-h> <C-w>h
let g:WhichKeyDesc_windows_go_lower = "<C-j> Go to Lower Window"
nnoremap <C-j> <C-w>j
let g:WhichKeyDesc_windows_go_upper = "<C-k> Go to Upper Window"
nnoremap <C-k> <C-w>k
let g:WhichKeyDesc_windows_go_right = "<C-l> Go to Right Window"
nnoremap <C-l> <C-w>l " Go to Right Window

let g:WhichKeyDesc_windows_delete = "<leader>wd Deete Window"
nnoremap <leader>wd <C-W>c
let g:WhichKeyDesc_windows_go_left = "<leader>wh Go to Left Window"
nnoremap <leader>wh <C-W>h
let g:WhichKeyDesc_windows_go_lower = "<leader>wj Go to Lower Window"
nnoremap <leader>wj <C-W>j
let g:WhichKeyDesc_windows_go_upper = "<leader>wk Go to Upper Window"
nnoremap <leader>wk <C-W>k
let g:WhichKeyDesc_windows_go_right = "<leader>wd Go to Right Window"
nnoremap <leader>wl <C-W>l

let g:WhichKeyDesc_windows_zoom = "<leader>wm Zoom Window"
nnoremap <leader>wm <C-W>m " Enable Zoom mode ---------------
let g:WhichKeyDesc_windows_close_all_others = "<leader>wo Close all other windows"
nnoremap <leader>wo <C-W>o " Close all other windows
let g:WhichKeyDesc_windows_quit = "<leader>wq Quit Window"
nnoremap <leader>wq <C-W>q " Quit a window
nnoremap <leader>ws <C-W>s " Slit window
nnoremap <leader>wv <C-W>v " Slit window vertically
nnoremap <leader>ww <C-W>w " Switch windows
nnoremap <leader>wx <C-W>x " Swap current with next
nnoremap <leader>w+ <C-W>+ " Increase height
nnoremap <leader>w- <C-W>- " Decrease height
nnoremap <leader>w< <C-W>< " Increase width
nnoremap <leader>w= <C-W>= " Equally high and width
nnoremap <leader>w> <C-W>> " Decrease width
