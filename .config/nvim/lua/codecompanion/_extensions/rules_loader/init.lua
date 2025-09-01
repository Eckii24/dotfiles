-- lua/codecompanion/_extensions/rules_loader/init.lua
---@class CodeCompanion.Extension
local M = {}

local function is_abs(path)
  -- Unix absolut
  if path:sub(1, 1) == "/" then return true end
  -- Home-Verweis
  if path:sub(1, 1) == "~" then return true end
  -- Windows Drive Letter
  return path:match("^%a:[/\\]") ~= nil
end

local function project_root()
  -- 1) LSP workspace
  local ws = vim.lsp.buf.list_workspace_folders and vim.lsp.buf.list_workspace_folders() or {}
  if ws and ws[1] then return ws[1] end
  -- 2) Git root
  local ok, out = pcall(vim.fn.systemlist, { "git", "rev-parse", "--show-toplevel" })
  if ok and type(out) == "table" and out[1] and out[1] ~= "" and vim.v.shell_error == 0 then
    return out[1]
  end
  -- 3) CWD
  return vim.loop.cwd()
end

local function normalize(path, root)
  -- immer expandieren, damit ~ aufgelöst wird
  path = vim.fn.expand(path)

  if is_abs(path) then
    return vim.fn.fnamemodify(path, ":p")
  end

  return vim.fn.fnamemodify(root .. "/" .. path, ":p")
end

local function list_files(path)
  if vim.fn.isdirectory(path) == 1 then
    -- recursive glob; returns list of paths; filter to files only
    local all = vim.fn.glob(path .. "/**/*", true, true)
    local files = {}
    for _, p in ipairs(all) do
      if vim.fn.isdirectory(p) == 0 then table.insert(files, p) end
    end
    return files
  else
    if vim.fn.filereadable(path) == 1 then return { path } end
  end
  return {}
end

local function rel_to_root(root, p)
  local rp = vim.fn.fnamemodify(p, ":p")
  if rp:sub(1, #root) == root then
    local rel = rp:sub(#root + 2)
    if rel ~= "" then return rel end
  end
  return rp
end

local function read_file(p)
  local ok, lines = pcall(vim.fn.readfile, p)
  if not ok or not lines then return "" end
  return table.concat(lines, "\n")
end

local function fence_lang(path)
  local ext = (path:match("^.+(%.[^/\\%.]+)$") or ""):sub(2)
  if ext == "" then return "" end
  -- map a few common ones; fallback empty
  local map = { lua = "lua", ts = "typescript", js = "javascript", json = "json", yml = "yaml", yaml = "yaml", md = "markdown", toml = "toml", rs = "rust", py = "python", go = "go", sh = "sh", bash = "bash", zsh = "bash", conf = "" }
  return map[ext] or ""
end

---@param opts table { paths = string[] }
local function make_rules_callback(opts)
  local cfg_paths = opts.paths or {}
  return function()
    local root = project_root()
    local acc = {}
    for _, p in ipairs(cfg_paths) do
      local abs = normalize(p, root)
      for _, f in ipairs(list_files(abs)) do
        local rel = rel_to_root(root, f)
        local lang = fence_lang(f)
        local body = read_file(f)
        if body ~= "" then
          table.insert(acc, ("### %s\n```%s\n%s\n```"):format(rel, lang, body))
        end
      end
    end
    -- Returning a single string is enough; CodeCompanion will add it as a Context block
    return table.concat(acc, "\n\n")
  end
end

--- Setup is called once during CodeCompanion setup
---@param opts table  Example: { paths = { ".codecompanion/rules", "/etc/cc/rules/global.md" } }
function M.setup(opts)
  local cfg = require("codecompanion.config")
  cfg.strategies = cfg.strategies or {}
  cfg.strategies.chat = cfg.strategies.chat or {}
  cfg.strategies.chat.variables = cfg.strategies.chat.variables or {}

  cfg.strategies.chat.variables["rules"] = {
    -- You can also point this to a Lua file path, but we keep it inline for simplicity
    callback = make_rules_callback(opts or {}),
    description = "Insert configured rule files and folders (recursive) into the chat",
    opts = {
      contains_code = true, -- improves rendering
      -- has_params = false, default
    },
  }
end

M.exports = {}

return M