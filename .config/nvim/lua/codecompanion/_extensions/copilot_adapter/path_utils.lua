-- lua/codecompanion/_extensions/copilot_adapter/path_utils.lua
-- Path utilities for finding Copilot prompt files

local M = {}

---Check if path is absolute
---@param path string
---@return boolean
local function is_abs(path)
  -- Unix absolute
  if path:sub(1, 1) == "/" then return true end
  -- Home reference
  if path:sub(1, 1) == "~" then return true end
  -- Windows Drive Letter
  return path:match("^%a:[/\\]") ~= nil
end

---Get project root directory
---@return string
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

---Normalize path (expand ~ and make absolute)
---@param path string
---@param root string|nil
---@return string
local function normalize_path(path, root)
  root = root or project_root()
  
  -- always expand to resolve ~ paths
  path = vim.fn.expand(path)

  if is_abs(path) then
    return vim.fn.fnamemodify(path, ":p")
  end

  -- ensure proper path concatenation without double slashes
  local clean_root = root:gsub("/$", "")
  local clean_path = path:gsub("^/", "")
  return vim.fn.fnamemodify(clean_root .. "/" .. clean_path, ":p")
end

---List files in a directory that match a filter
---@param path string
---@param filter function|nil Optional filter function
---@return string[] List of file paths
function M.list_files(path, filter)
  path = normalize_path(path)
  
  -- only treat as directory if path explicitly ends with "/"
  if path:sub(-1) == "/" and vim.fn.isdirectory(path) == 1 then
    -- recursive glob; returns list of paths; filter to files only
    local all = vim.fn.glob(path .. "**/*", true, true)
    local files = {}
    for _, p in ipairs(all) do
      if vim.fn.isdirectory(p) == 0 then
        if not filter or filter(p) then
          table.insert(files, p)
        end
      end
    end
    return files
  else
    if vim.fn.filereadable(path) == 1 then
      if not filter or filter(path) then
        return { path }
      end
    end
  end
  return {}
end

---Get global Copilot prompt paths for different platforms
---@return string[]
function M.get_global_copilot_paths()
  local paths = {}
  
  -- Detect operating system
  local is_windows = vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
  local is_mac = vim.fn.has("mac") == 1 or vim.fn.has("macunix") == 1
  
  if is_windows then
    -- Windows paths
    local appdata = vim.fn.expand("$APPDATA")
    local userprofile = vim.fn.expand("$USERPROFILE")
    table.insert(paths, appdata .. "/GitHub Copilot/prompts/")
    table.insert(paths, userprofile .. "/.github/copilot/prompts/")
    table.insert(paths, userprofile .. "/Documents/GitHub Copilot/prompts/")
  elseif is_mac then
    -- macOS paths
    local home = vim.fn.expand("~")
    table.insert(paths, home .. "/Library/Application Support/GitHub Copilot/prompts/")
    table.insert(paths, home .. "/.github/copilot/prompts/")
    table.insert(paths, home .. "/.config/github-copilot/prompts/")
  else
    -- Linux/Unix paths
    local home = vim.fn.expand("~")
    local xdg_config = vim.fn.expand("$XDG_CONFIG_HOME")
    if xdg_config == "$XDG_CONFIG_HOME" then
      xdg_config = home .. "/.config"
    end
    
    table.insert(paths, xdg_config .. "/github-copilot/prompts/")
    table.insert(paths, home .. "/.github/copilot/prompts/")
    table.insert(paths, home .. "/.local/share/github-copilot/prompts/")
  end
  
  return paths
end

---Check if a file exists and is readable
---@param path string
---@return boolean
function M.file_exists(path)
  return vim.fn.filereadable(vim.fn.expand(path)) == 1
end

---Check if a directory exists
---@param path string  
---@return boolean
function M.dir_exists(path)
  return vim.fn.isdirectory(vim.fn.expand(path)) == 1
end

return M