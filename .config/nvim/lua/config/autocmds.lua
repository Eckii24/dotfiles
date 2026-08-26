-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
--
-- Add any additional autocmds here
-- with `vim.api.nvim_create_autocmd`
--
-- Or remove existing autocmds by their group name (which is prefixed with `lazyvim_` for the defaults)
-- e.g. vim.api.nvim_del_augroup_by_name("lazyvim_wrap_spell")

-- Roslyn can emit malformed $/progress notifications without `token` or
-- `value` (https://github.com/dotnet/roslyn/issues/79939). Do not disable
-- Noice progress globally; replace its handler only after C# support is active
-- and discard only malformed events.
local noice_progress_guard_installed = false

vim.api.nvim_create_autocmd("FileType", {
  pattern = "cs",
  callback = function()
    if noice_progress_guard_installed then
      return
    end

    local group = "noice_lsp_progress"
    -- Noice creates this group lazily on VeryLazy. Opening a C# file before
    -- that point must not abort its FileType handler.
    local ok = pcall(vim.api.nvim_clear_autocmds, { group = group, event = "LspProgress" })
    if not ok then
      return
    end

    noice_progress_guard_installed = true
    vim.api.nvim_create_autocmd("LspProgress", {
      group = group,
      callback = function(event)
        local params = event.data and (event.data.params or event.data.result)
        if type(params) ~= "table" or params.token == nil or type(params.value) ~= "table" then
          return
        end

        require("noice.lsp.progress").progress(event.data)
      end,
    })
  end,
})
