-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Terminal Mappings
vim.keymap.set("n", "<c-t>", function()
  Snacks.terminal(nil)
end, { desc = "Terminal (Root Dir)" })
vim.keymap.set("t", "<C-t>", "<cmd>close<CR>", { desc = "Hide Terminal" })
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

-- Copy / Paste
vim.keymap.set("v", "p", '"_dP', { desc = "Paste without yanking" })

-- LSP Restart
vim.keymap.set("n", "<leader>cL", "<cmd>lsp restart<CR>", { desc = "Restart LSP" })

-- Yanking file paths
vim.keymap.set("n", "<leader>yp", function()
  local file_path = vim.fn.expand("%:p")
  vim.fn.setreg("+", file_path)
  vim.notify("Copied file path: " .. file_path, vim.log.levels.INFO)
end, { desc = "Yank file path" })
vim.keymap.set("n", "<leader>yP", function()
  local file_path = vim.fn.expand("%:p:h")
  vim.fn.setreg("+", file_path)
  vim.notify("Copied file path: " .. file_path, vim.log.levels.INFO)
end, { desc = "Yank file path (directory)" })
