-- lua/codecompanion/_extensions/copilot_prompts/init.lua
---@class CodeCompanion.Extension
local M = {}

local yaml_parser = require("codecompanion._extensions.copilot_prompts.yaml_parser")
local path_utils = require("codecompanion._extensions.copilot_prompts.path_utils")

-- Internal state (for listing functionality)
local loaded_prompts = {}

---@param path string
---@return boolean
local function is_prompt_file(path)
  return path:match("%.prompt%.md$") ~= nil or path:match("%.chatmode%.md$") ~= nil
end

local function is_chatmode_file(path)
  return path:match("%.chatmode%.md$") ~= nil
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
  -- Remove .prompt.md or .chatmode.md extension
  local base_name = vim.fn.fnamemodify(name, ":t:r:r")
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

---Adjust markdown headers to avoid conflicts with CodeCompanion's chat buffer format
---CodeCompanion uses ## (H2) to separate user/system/LLM messages, so we need to
---make all headers in prompts deeper to avoid breaking the chat display
---@param content string
---@return string
local function adjust_markdown_headers(content)
  if not content or content == "" then
    return content
  end
  
  -- Split content into lines for processing
  local lines = vim.split(content, "\n", { plain = true })
  local adjusted_lines = {}
  
  for _, line in ipairs(lines) do
    -- Match markdown headers (# at start of line, followed by space)
    local header_hashes, header_text = line:match("^(#+)%s+(.*)$")
    if header_hashes and header_text then
      -- Add two more # symbols to make headers deeper
      -- H1 (#) -> H3 (###), H2 (##) -> H4 (####), etc.
      local adjusted_line = "##" .. header_hashes .. " " .. header_text
      table.insert(adjusted_lines, adjusted_line)
    else
      table.insert(adjusted_lines, line)
    end
  end
  
  return table.concat(adjusted_lines, "\n")
end

---Apply various content adjustments to prompt content
---This function provides a centralized place for content transformations
---that may be needed for CodeCompanion compatibility
---@param content string
---@param opts table|nil Optional configuration for adjustments
---@return string
local function adjust_prompt_content(content, opts)
  if not content then
    return ""
  end
  
  opts = opts or {}
  local adjusted_content = content
  
  -- Adjust markdown headers to avoid conflicts with chat buffer format
  if opts.adjust_headers ~= false then
    adjusted_content = adjust_markdown_headers(adjusted_content)
  end
  
  -- Future content adjustments can be added here
  -- e.g., if opts.adjust_tables then ... end
  -- e.g., if opts.adjust_code_blocks then ... end
  
  return adjusted_content
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
  
  -- Handle VS Code custom chat modes vs prompts
  -- VS Code uses file extensions: .chatmode.md for modes, .prompt.md for prompts
  local is_automode = is_chatmode_file(file_path)
  if is_automode and not opts.enable_chatmodes then
    return nil
  elseif not is_automode and not opts.enable_prompts then
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
          local prefixed_content = apply_content_prefix(body, content_prefix, ctx)
          return adjust_prompt_content(prefixed_content, opts.content_adjustments)
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

---List all loaded chatmodes (deprecated, kept for compatibility)
---@return table  
function M.list_chatmodes()
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
    enable_chatmodes = true,
    content_prefix = "",
    content_adjustments = {
      adjust_headers = true,
    },
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
  list_chatmodes = M.list_chatmodes,
  reload = M.reload,
}

return M