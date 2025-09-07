-- lua/codecompanion/_extensions/copilot_adapter/init.lua
---@class CodeCompanion.Extension
local M = {}

local yaml_parser = require("codecompanion._extensions.copilot_adapter.yaml_parser")
local path_utils = require("codecompanion._extensions.copilot_adapter.path_utils")

-- Internal state (for listing functionality)
local loaded_prompts = {}

---@param path string
---@return boolean
local function is_prompt_file(path)
  return path:match("%.prompt%.md$") ~= nil
end

---@param content string
---@return table|nil frontmatter, string body
local function parse_prompt_file(content)
  -- Look for YAML frontmatter between --- markers
  local frontmatter_pattern = "^%-%-%-\n(.-)\n%-%-%-\n(.*)$"
  local yaml_content, markdown_body = content:match(frontmatter_pattern)
  
  if not yaml_content then
    -- No frontmatter, treat entire content as body
    return {}, content
  end
  
  local frontmatter = yaml_parser.parse(yaml_content)
  return frontmatter or {}, markdown_body or ""
end

---@param file_path string
---@return string
local function read_file(file_path)
  local ok, lines = pcall(vim.fn.readfile, file_path)
  if not ok or not lines then 
    return "" 
  end
  return table.concat(lines, "\n")
end

---@param name string
---@return string
local function normalize_prompt_name(name)
  -- Convert filename to snake_case command name
  local base_name = vim.fn.fnamemodify(name, ":t:r:r") -- Remove .prompt.md
  return base_name:gsub("%-", "_")
end

---@param content string
---@param prefix string|function
---@param ctx table
---@return string
local function apply_content_prefix(content, prefix, ctx)
  if not prefix or prefix == "" then
    return content
  end
  
  local prefix_text = prefix
  if type(prefix) == "function" then
    prefix_text = prefix(ctx) or ""
  end
  
  if prefix_text == "" then
    return content
  end
  
  -- Prepend prefix to content
  return prefix_text .. "\n\n" .. content
end

---@param opts table
---@return string[]
local function discover_prompt_files(opts)
  local files = {}
  local paths = opts.paths or {}
  
  -- Default workspace paths
  if paths.workspace ~= false then
    local workspace_paths = {
      "./.github/prompts/",
    }
    for _, wp in ipairs(workspace_paths) do
      vim.list_extend(files, path_utils.list_files(wp, is_prompt_file))
    end
  end
  
  -- Global user paths
  if paths.global ~= false then
    local global_paths = path_utils.get_global_copilot_paths()
    for _, gp in ipairs(global_paths) do
      vim.list_extend(files, path_utils.list_files(gp, is_prompt_file))
    end
  end
  
  -- Extra paths
  if paths.extra then
    for _, ep in ipairs(paths.extra) do
      vim.list_extend(files, path_utils.list_files(ep, is_prompt_file))
    end
  end
  
  return files
end

---@param file_path string
---@param opts table
---@return table|nil
local function process_prompt_file(file_path, opts)
  local content = read_file(file_path)
  if content == "" then
    return nil
  end
  
  local frontmatter, body = parse_prompt_file(content)
  local prompt_name = normalize_prompt_name(file_path)
  
  -- Handle VS Code custom chat modes
  -- VS Code uses 'mode' field for custom chat modes (not just "ask" filter)
  local is_mode = frontmatter.mode ~= nil and frontmatter.mode ~= ""
  if is_mode and not opts.enable_modes then
    return nil
  elseif not is_mode and not opts.enable_prompts then
    return nil
  end
  
  -- Determine content prefix settings
  local content_prefix = frontmatter.cc_prefix or opts.content_prefix or ""
  
  -- Create prompt entry
  local prompt_entry = {
    strategy = "chat",
    description = frontmatter.description or ("Copilot prompt: " .. prompt_name),
    opts = {
      is_slash_cmd = true,
      short_name = prompt_name,
      auto_submit = false,
    },
    prompts = {
      {
        role = "user",
        content = function()
          local ctx = {
            prompt_name = prompt_name,
            source_path = file_path,
            frontmatter = frontmatter,
            bufnr = vim.api.nvim_get_current_buf(),
            filetype = vim.bo.filetype,
            cwd = vim.fn.getcwd(),
          }
          return apply_content_prefix(body, content_prefix, ctx)
        end,
      },
    },
  }
  
  return prompt_entry
end

---@param opts table
local function register_prompts(opts)
  local cfg = require("codecompanion.config")
  cfg.prompt_library = cfg.prompt_library or {}
  
  local files = discover_prompt_files(opts)
  local prompt_count = 0
  
  for _, file_path in ipairs(files) do
    local prompt_entry = process_prompt_file(file_path, opts)
    if prompt_entry then
      local prompt_name = normalize_prompt_name(file_path)
      
      -- Apply namespace if configured
      local command_name = prompt_name
      if opts.slash_namespace then
        command_name = opts.slash_namespace .. "_" .. prompt_name
      end
      
      cfg.prompt_library[command_name] = prompt_entry
      loaded_prompts[command_name] = prompt_entry
      prompt_count = prompt_count + 1
    end
  end
  
  if prompt_count > 0 then
    vim.notify(string.format("CodeCompanion: Loaded %d Copilot prompts", prompt_count), vim.log.levels.INFO)
  end
end

---List all loaded prompts
---@return table
function M.list_prompts()
  return vim.deepcopy(loaded_prompts)
end

---List all loaded modes (deprecated, kept for compatibility)
---@return table  
function M.list_modes()
  return {}
end

---Reload all prompts
---@param opts table|nil
function M.reload(opts)
  local cfg = require("codecompanion.config")
  
  -- Clear existing loaded prompts
  for name, _ in pairs(loaded_prompts) do
    cfg.prompt_library[name] = nil
  end
  loaded_prompts = {}
  
  -- Re-register with current or provided opts
  local current_opts = M._current_opts or {}
  register_prompts(vim.tbl_deep_extend("force", current_opts, opts or {}))
end

---Setup the extension
---@param opts table Configuration options
function M.setup(opts)
  opts = opts or {}
  
  -- Store opts for reload functionality
  M._current_opts = opts
  
  -- Default configuration
  local defaults = {
    enable_prompts = true,
    enable_modes = false,
    content_prefix = "",
    paths = {
      workspace = true,
      global = true,
      extra = {},
    },
    slash_namespace = nil,
  }
  
  local config = vim.tbl_deep_extend("force", defaults, opts)
  
  -- Only register prompts if enabled
  if config.enable_prompts then
    register_prompts(config)
  end
end

M.exports = {
  list_prompts = M.list_prompts,
  list_modes = M.list_modes,
  reload = M.reload,
}

return M