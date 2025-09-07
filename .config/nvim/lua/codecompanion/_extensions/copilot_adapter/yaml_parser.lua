-- lua/codecompanion/_extensions/copilot_adapter/yaml_parser.lua
-- Simple YAML parser for frontmatter

local M = {}

---Parse a simple YAML string into a Lua table
---@param yaml_content string
---@return table|nil
function M.parse(yaml_content)
  if not yaml_content or yaml_content == "" then
    return {}
  end
  
  local result = {}
  local lines = vim.split(yaml_content, "\n")
  
  for _, line in ipairs(lines) do
    line = line:gsub("^%s+", ""):gsub("%s+$", "") -- trim whitespace
    
    if line ~= "" and not line:match("^#") then -- skip empty lines and comments
      local key, value = line:match("^([^:]+):%s*(.*)$")
      if key and value then
        key = key:gsub("^%s+", ""):gsub("%s+$", "")
        value = value:gsub("^%s+", ""):gsub("%s+$", "")
        
        -- Handle different value types
        if value == "" then
          result[key] = ""
        elseif value == "true" then
          result[key] = true
        elseif value == "false" then
          result[key] = false
        elseif value:match("^%d+$") then
          result[key] = tonumber(value)
        elseif value:match("^%d+%.%d+$") then
          result[key] = tonumber(value)
        elseif value:match("^%[.*%]$") then
          -- Simple array parsing
          local array_content = value:match("^%[(.*)%]$")
          local array = {}
          if array_content and array_content ~= "" then
            for item in array_content:gmatch([["?([^",]+)"?]]) do
              item = item:gsub("^%s+", ""):gsub("%s+$", ""):gsub('^"', ""):gsub('"$', "")
              if item ~= "" then
                table.insert(array, item)
              end
            end
          end
          result[key] = array
        elseif value:match('^".*"$') then
          -- Remove quotes
          result[key] = value:sub(2, -2)
        else
          result[key] = value
        end
      end
    end
  end
  
  return result
end

return M