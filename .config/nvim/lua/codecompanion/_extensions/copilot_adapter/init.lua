-- lua/codecompanion/_extensions/copilot_adapter/init.lua
---@class CodeCompanion.Extension
local M = {}

local yaml_parser = require("codecompanion._extensions.copilot_adapter.yaml_parser")
local path_utils = require("codecompanion._extensions.copilot_adapter.path_utils")

-- Internal state
local registered_prompts = {}
local registered_modes = {}

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
---@param prefix_role string
---@param ctx table
---@return string
local function apply_content_prefix(content, prefix, prefix_role, ctx)
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
  
  -- For now, always prepend to content regardless of role
  -- TODO: Handle system role when CodeCompanion supports it
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
  
  -- Handle mode filtering
  local is_mode = frontmatter.mode and frontmatter.mode ~= "ask"
  if is_mode and not opts.enable_modes then
    return nil
  elseif not is_mode and not opts.enable_prompts then
    return nil
  end
  
  -- Determine content prefix settings
  local content_prefix = frontmatter.cc_prefix or opts.content_prefix or ""
  local content_prefix_role = frontmatter.cc_prefix_role or opts.content_prefix_role or "system"
  local content_prefix_when = frontmatter.cc_prefix_when or opts.content_prefix_when or "invoke"
  
  -- Apply prefix at registration time if configured
  local final_body = body
  if content_prefix_when == "register" then
    local ctx = {
      prompt_name = prompt_name,
      source_path = file_path,
      frontmatter = frontmatter,
    }
    final_body = apply_content_prefix(body, content_prefix, content_prefix_role, ctx)
  end
  
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
        content = content_prefix_when == "invoke" and function()
          local ctx = {
            prompt_name = prompt_name,
            source_path = file_path,
            frontmatter = frontmatter,
            bufnr = vim.api.nvim_get_current_buf(),
            filetype = vim.bo.filetype,
            cwd = vim.fn.getcwd(),
          }
          return apply_content_prefix(body, content_prefix, content_prefix_role, ctx)
        end or final_body,
      },
    },
    -- Store metadata
    _copilot_meta = {
      source_path = file_path,
      frontmatter = frontmatter,
      original_body = body,
      content_prefix = content_prefix,
      content_prefix_role = content_prefix_role,
      content_prefix_when = content_prefix_when,
      is_mode = is_mode,
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
  local mode_count = 0
  
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
      
      -- Track registration
      if prompt_entry._copilot_meta.is_mode then
        registered_modes[command_name] = prompt_entry
        mode_count = mode_count + 1
      else
        registered_prompts[command_name] = prompt_entry
        prompt_count = prompt_count + 1
      end
    end
  end
  
  if prompt_count > 0 or mode_count > 0 then
    local message = string.format("CodeCompanion: Loaded %d Copilot prompts", prompt_count)
    if mode_count > 0 then
      message = message .. string.format(" and %d modes", mode_count)
    end
    vim.notify(message, vim.log.levels.INFO)
  end
end

---List all loaded prompts
---@return table
function M.list_prompts()
  return vim.deepcopy(registered_prompts)
end

---List all loaded modes
---@return table  
function M.list_modes()
  return vim.deepcopy(registered_modes)
end

---Reload all prompts
---@param opts table|nil
function M.reload(opts)
  local cfg = require("codecompanion.config")
  
  -- Clear existing registered prompts and modes
  for name, _ in pairs(registered_prompts) do
    cfg.prompt_library[name] = nil
  end
  for name, _ in pairs(registered_modes) do
    cfg.prompt_library[name] = nil
  end
  registered_prompts = {}
  registered_modes = {}
  
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
    content_prefix_role = "system", 
    content_prefix_when = "invoke",
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