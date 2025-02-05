-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set:
-- https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
vim.g.autoformat = false
vim.opt.colorcolumn = "100"

-- required secrets config, if the file exists
if vim.fn.filereadable(vim.fn.expand("~/.config/nvim/lua/config/secrets.lua")) then
  require("config.secrets")
end
