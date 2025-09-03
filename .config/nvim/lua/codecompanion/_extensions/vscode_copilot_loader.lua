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
  -- Exclude GitHub Copilot instructions as they're handled by rules_loader
  return {
    ".vscode/copilot-chat/",
    ".vscode/copilot/", 
    ".copilot/",
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
        -- Filter for relevant file types (markdown, json, txt)
        local ext = vim.fn.fnamemodify(p, ":e"):lower()
        if ext == "md" or ext == "json" or ext == "txt" then
          -- Skip GitHub Copilot instructions as they're handled by rules_loader
          local basename = vim.fn.fnamemodify(p, ":t"):lower()
          if not (basename:match("copilot%-instruction") or basename:match("instruction")) then
            table.insert(files, p) 
          end
        end
      end
    end
    return files
  else
    if vim.fn.filereadable(path) == 1 then 
      local ext = vim.fn.fnamemodify(path, ":e"):lower()
      local basename = vim.fn.fnamemodify(path, ":t"):lower()
      if (ext == "md" or ext == "json" or ext == "txt") and 
         not (basename:match("copilot%-instruction") or basename:match("instruction")) then
        return { path } 
      end
    end
  end
  return {}
end

local function read_file(p)
  local ok, lines = pcall(vim.fn.readfile, p)
  if not ok or not lines then 
    -- Silently skip unreadable files
    return "" 
  end
  return table.concat(lines, "\n")
end

local function parse_prompt_content(content, filepath)
  local ext = vim.fn.fnamemodify(filepath, ":e"):lower()
  
  if ext == "md" then
    return content, nil
  elseif ext == "json" then
    -- Try to parse JSON and extract relevant prompt content
    local ok, parsed = pcall(vim.fn.json_decode, content)
    if ok and parsed then
      -- Handle different JSON structures for chat modes
      if parsed.prompt then
        return parsed.prompt, parsed
      elseif parsed.description then
        return parsed.description, parsed
      elseif parsed.instructions then
        return parsed.instructions, parsed
      end
    end
    -- If JSON parsing fails, return content as-is
    return content, nil
  else
    return content, nil
  end
end

local function generate_short_name(filepath, parsed_json)
  -- For JSON files, prefer the "name" field if available
  if parsed_json and parsed_json.name then
    local name = parsed_json.name:lower()
    name = name:gsub("%-", "_")  -- replace dashes with underscores
    name = name:gsub("%s+", "_")  -- replace spaces with underscores  
    name = name:gsub("[^%w_]", "")  -- remove non-alphanumeric except underscores
    return name
  end
  
  -- Fall back to filename
  local basename = vim.fn.fnamemodify(filepath, ":t:r")  -- filename without extension
  -- Convert to snake_case and sanitize
  local short_name = basename:lower()
  short_name = short_name:gsub("%-", "_")  -- replace dashes with underscores
  short_name = short_name:gsub("%s+", "_")  -- replace spaces with underscores  
  short_name = short_name:gsub("[^%w_]", "")  -- remove non-alphanumeric except underscores
  return short_name
end

local function generate_display_name(filepath, parsed_json)
  -- For JSON files, prefer the "name" field if available
  if parsed_json and parsed_json.name then
    return parsed_json.name
  end
  
  -- Fall back to filename
  local basename = vim.fn.fnamemodify(filepath, ":t:r")  -- filename without extension
  -- Convert to Title Case
  local display_name = basename:gsub("%-", " "):gsub("_", " ")
  display_name = display_name:gsub("(%w)([%w]*)", function(first, rest) 
    return first:upper() .. rest:lower() 
  end)
  return display_name
end

--- Discover and return prompt definitions for VSCode Copilot files
---@param opts table Configuration options
local function get_copilot_prompts(opts)
  local project_enabled = opts.project_level ~= false  -- default true
  local user_enabled = opts.user_level ~= false        -- default true
  local custom_paths = opts.custom_paths or {}
  local debug = opts.debug or false
  
  local root = project_root()
  local prompts = {}
  local all_paths = {}
  local file_count = 0
  
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
      local body = read_file(f)
      if body ~= "" then
        local content, parsed_json = parse_prompt_content(body, f)
        local short_name = generate_short_name(f, parsed_json)
        local display_name = generate_display_name(f, parsed_json)
        
        prompts[display_name] = {
          strategy = "chat",
          description = "VSCode Copilot: " .. display_name,
          opts = {
            is_slash_cmd = true,
            auto_submit = false,
            short_name = short_name,
          },
          prompts = {
            {
              role = "user",
              content = content,
            },
          },
        }
        
        file_count = file_count + 1
        
        if debug then
          print(string.format("[VSCode Copilot] Created prompt /%s for: %s (%d chars)", 
            short_name, f, #content))
        end
      end
    end
  end
  
  if debug then
    print(string.format("[VSCode Copilot] Created %d prompts from %d paths", file_count, #all_paths))
  end
  
  return prompts
end

--- Setup is called once during CodeCompanion setup
---@param opts table Configuration options:
---   - project_level: boolean (default true) - Enable scanning project-level files
---   - user_level: boolean (default true) - Enable scanning user-level files  
---   - create_slash_commands: boolean (default true) - Create slash commands for each prompt
---   - custom_paths: string[] (default {}) - Additional custom paths to scan
---   - debug: boolean (default false) - Enable debug logging
function M.setup(opts)
  opts = opts or {}
  
  -- Check if slash commands should be created
  local create_slash_commands = opts.create_slash_commands ~= false  -- default true
  
  if not create_slash_commands then
    return  -- Exit early if slash commands are disabled
  end
  
  -- Get the prompts from VSCode Copilot files
  local copilot_prompts = get_copilot_prompts(opts)
  
  -- Store the prompts for later use by the main config
  M.prompts = copilot_prompts
end

--- Get the discovered prompts (called by main config)
function M.get_prompts()
  return M.prompts or {}
end

M.exports = {}

return M