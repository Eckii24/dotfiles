-- lua/codecompanion/_extensions/vscode_copilot_loader.lua
---@class CodeCompanion.Extension
local M = {}

local function is_abs(path)
  -- Unix absolute
  if path:sub(1, 1) == "/" then return true end
  -- Home reference
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

local function get_user_copilot_paths()
  local paths = {}
  
  -- Detect OS and add appropriate user paths
  local is_windows = vim.fn.has("win32") == 1 or vim.fn.has("win64") == 1
  local is_mac = vim.fn.has("mac") == 1 or vim.fn.has("macunix") == 1
  
  if is_windows then
    -- Windows paths
    table.insert(paths, "$APPDATA/Code/User/copilot-chat/")
    table.insert(paths, "$APPDATA/Code/User/copilot/")
    table.insert(paths, "$USERPROFILE/.vscode/copilot/")
  elseif is_mac then
    -- macOS paths
    table.insert(paths, "~/Library/Application Support/Code/User/copilot-chat/")
    table.insert(paths, "~/Library/Application Support/Code/User/copilot/")
    table.insert(paths, "~/.vscode/copilot/")
  else
    -- Linux/Unix paths
    table.insert(paths, "~/.config/Code/User/copilot-chat/")
    table.insert(paths, "~/.config/Code/User/copilot/")
    table.insert(paths, "~/.vscode/copilot/")
  end
  
  return paths
end

local function get_project_copilot_paths()
  return {
    ".github/copilot-instructions.md",
    ".github/copilot/",
    ".vscode/copilot-chat/",
    ".vscode/copilot/", 
    ".copilot/",
    "copilot-instructions.md"
  }
end

local function list_files(path)
  -- only treat as directory if path explicitly ends with "/"
  if path:sub(-1) == "/" and vim.fn.isdirectory(path) == 1 then
    -- recursive glob; returns list of paths; filter to files only
    local all = vim.fn.glob(path .. "**/*", true, true)
    local files = {}
    for _, p in ipairs(all) do
      if vim.fn.isdirectory(p) == 0 then 
        -- Filter for relevant file types (markdown, json)
        local ext = vim.fn.fnamemodify(p, ":e"):lower()
        if ext == "md" or ext == "json" or ext == "txt" then
          table.insert(files, p) 
        end
      end
    end
    return files
  else
    if vim.fn.filereadable(path) == 1 then 
      local ext = vim.fn.fnamemodify(path, ":e"):lower()
      if ext == "md" or ext == "json" or ext == "txt" then
        return { path } 
      end
    end
  end
  return {}
end

local function read_file(p)
  local ok, lines = pcall(vim.fn.readfile, p)
  if not ok or not lines then return "" end
  return table.concat(lines, "\n")
end

local function parse_prompt_content(content, filepath, opts)
  -- Apply custom prefix if configured
  local prefix = opts.custom_prefix or ""
  if prefix ~= "" and not prefix:match("%s$") then
    prefix = prefix .. " "
  end
  
  -- For markdown files, try to extract structured prompts
  local ext = vim.fn.fnamemodify(filepath, ":e"):lower()
  if ext == "md" then
    return prefix .. content
  elseif ext == "json" then
    -- Try to parse JSON and extract relevant prompt content
    local ok, parsed = pcall(vim.fn.json_decode, content)
    if ok and parsed then
      -- Handle different JSON structures for chat modes
      if parsed.prompt then
        return prefix .. parsed.prompt
      elseif parsed.description then
        return prefix .. parsed.description
      elseif parsed.instructions then
        return prefix .. parsed.instructions
      end
    end
    return prefix .. content
  else
    return prefix .. content
  end
end

local function should_include_file(filepath, opts)
  local basename = vim.fn.fnamemodify(filepath, ":t"):lower()
  local ext = vim.fn.fnamemodify(filepath, ":e"):lower()
  
  -- Check if we should include chat modes
  if not opts.include_chat_modes then
    -- Skip files that look like chat mode definitions
    if basename:match("mode") or basename:match("chat") then
      return false
    end
  end
  
  return ext == "md" or ext == "json" or ext == "txt"
end

---@param opts table Configuration options
local function make_copilot_callback(opts)
  local project_enabled = opts.project_level ~= false  -- default true
  local user_enabled = opts.user_level ~= false        -- default true
  local custom_paths = opts.custom_paths or {}
  
  return function()
    local root = project_root()
    local acc = {}
    local all_paths = {}
    
    -- Add custom paths first
    for _, p in ipairs(custom_paths) do
      table.insert(all_paths, p)
    end
    
    -- Add project-level paths if enabled
    if project_enabled then
      for _, p in ipairs(get_project_copilot_paths()) do
        table.insert(all_paths, p)
      end
    end
    
    -- Add user-level paths if enabled  
    if user_enabled then
      for _, p in ipairs(get_user_copilot_paths()) do
        table.insert(all_paths, p)
      end
    end
    
    for _, p in ipairs(all_paths) do
      local abs = normalize(p, root)
      for _, f in ipairs(list_files(abs)) do
        if should_include_file(f, opts) then
          local body = read_file(f)
          if body ~= "" then
            local processed_content = parse_prompt_content(body, f, opts)
            local display_name = vim.fn.fnamemodify(f, ":t:r")  -- filename without extension
            table.insert(acc, ("### VSCode Copilot: %s\n```\n%s\n```"):format(display_name, processed_content))
          end
        end
      end
    end
    
    -- Returning a single string is enough; CodeCompanion will add it as a Context block
    return table.concat(acc, "\n\n")
  end
end

--- Setup is called once during CodeCompanion setup
---@param opts table Configuration options:
---   - project_level: boolean (default true) - Enable scanning project-level files
---   - user_level: boolean (default true) - Enable scanning user-level files  
---   - include_chat_modes: boolean (default false) - Include chat mode files as prompts
---   - custom_prefix: string (default "") - Prefix to add to all prompts
---   - custom_paths: string[] (default {}) - Additional custom paths to scan
function M.setup(opts)
  opts = opts or {}
  
  local cfg = require("codecompanion.config")
  cfg.strategies = cfg.strategies or {}
  cfg.strategies.chat = cfg.strategies.chat or {}
  cfg.strategies.chat.variables = cfg.strategies.chat.variables or {}

  cfg.strategies.chat.variables["vscode_copilot"] = {
    callback = make_copilot_callback(opts),
    description = "Insert VSCode GitHub Copilot prompts and chat modes into the chat",
    opts = {
      contains_code = true, -- improves rendering
    },
  }
  
  -- Also create a shorter alias
  cfg.strategies.chat.variables["copilot"] = cfg.strategies.chat.variables["vscode_copilot"]
end

M.exports = {}

return M