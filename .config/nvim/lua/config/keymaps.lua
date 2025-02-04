-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Terminal Mappings
vim.keymap.set("n", "<c-t>", function() Snacks.terminal(nil) end, { desc = "Terminal (Root Dir)" })
vim.keymap.set("t", "<C-t>", "<cmd>close<CR>", { desc = "Hide Terminal" })
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

-- AI completion
vim.keymap.set("i", ",,m", require("copilot.suggestion").next, { desc = "Next AI suggestion" })
vim.keymap.set("i", ",,n", require("copilot.suggestion").prev, { desc = "Previous AI suggestion" })

-- New lines
vim.keymap.set("n", "<leader>o", "o<Esc>0D", { desc = "which_key_ignore" })
vim.keymap.set("n", "<leader>O", "O<Esc>0D", { desc = "which_key_ignore" })

-- Diffs
vim.keymap.set("n", "<leader>fd", "", { desc = "+diff"})
vim.keymap.set("n", "<leader>fda", "<cmd>windo diffthis<CR>", { desc = "Diff this all windows"})
vim.keymap.set("n", "<leader>fdo", "<cmd>diffoff!<CR>", { desc = "Diff off all windows"})
vim.keymap.set("n", "<leader>fdg", "<cmd>diffget<CR>", { desc = "Get the change from the other buffer"})
vim.keymap.set("n", "<leader>fdg", "<cmd>diffput<CR>", { desc = "Puts the change to the other buffer"})
vim.keymap.set("n", "<leader>fdd", function()
  vim.cmd("diffoff!")
  vim.cmd("only")
end, { desc = "Diff off all windows and close inactive windows"})
