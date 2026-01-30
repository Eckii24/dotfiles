-- Options are automatically loaded before lazy.nvim startup
-- Default options that are always set:
-- https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/options.lua
-- Add any additional options here
vim.opt.colorcolumn = "120"

if vim.env.COPILOT_BASE and vim.env.COPILOT_BASE ~= "githubcopilot.com" then
  vim.lsp.config("copilot", {
    settings = {
      ["github-enterprise"] = {
        uri = "https://" .. vim.env.COPILOT_BASE,
      },
    },
  })
end
