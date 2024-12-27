-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

-- Terminal Mappings
vim.keymap.set("n", "<c-t>", function() Snacks.terminal(nil) end, { desc = "Terminal (Root Dir)" })
vim.keymap.set("t", "<C-t>", "<cmd>close<cr>", { desc = "Hide Terminal" })

-- AI completion
-- vim.keymap.set("i", "<C-M>", require("copilot.suggestion").next, { desc = "Next AI suggestion" })
