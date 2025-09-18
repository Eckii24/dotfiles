-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here

-- Terminal Mappings
vim.keymap.set("n", "<c-t>", function()
  Snacks.terminal(nil)
end, { desc = "Terminal (Root Dir)" })
vim.keymap.set("t", "<C-t>", "<cmd>close<CR>", { desc = "Hide Terminal" })
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })

-- LSP Restart
vim.keymap.set("n", "<leader>cL", "<cmd>LspRestart<CR>", { desc = "Restart LSP" })

-- Diffs
vim.keymap.set("n", "<leader>fd", "", { desc = "+diff" })
vim.keymap.set("n", "<leader>fda", "<cmd>windo diffthis<CR>", { desc = "Diff this all windows" })
vim.keymap.set("n", "<leader>fdo", "<cmd>diffoff!<CR>", { desc = "Diff off all windows" })
vim.keymap.set("n", "<leader>fdg", "<cmd>diffget<CR>", { desc = "Get the change from the other buffer" })
vim.keymap.set("v", "<leader>fdg", ":'<,'>diffget<CR>", { desc = "Get the change from the other buffer" })
vim.keymap.set("n", "<leader>fdp", "<cmd>diffput<CR>", { desc = "Puts the change to the other buffer" })
vim.keymap.set("v", "<leader>fdp", ":'<,'>diffput<CR>", { desc = "Puts the change to the other buffer" })
vim.keymap.set("n", "<leader>fdd", function()
  vim.cmd("diffoff!")
  vim.cmd("only")
end, { desc = "Diff off all windows and close inactive windows" })

-- Yank always into system clipboard
vim.keymap.set({ "n", "v" }, "y", '"+y', { desc = "Yank to clipboard" })
vim.keymap.set("n", "Y", '"+Y', { desc = "Yank line to clipboard" })

-- Paste from system clipboard
vim.keymap.set("n", "p", '"+p', { desc = "Paste from clipboard" })
vim.keymap.set("n", "P", '"+P', { desc = "Paste before from clipboard" })

-- Visual paste: replace selection with clipboard contents, but don’t yank replaced text
vim.keymap.set("v", "p", '"_d"+P', { desc = "Paste from clipboard without yanking" })

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
