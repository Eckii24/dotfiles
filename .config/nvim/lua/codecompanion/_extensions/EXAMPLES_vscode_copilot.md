# Advanced Usage Examples

This file demonstrates advanced usage patterns for the VSCode Copilot extension.

## Example 1: Basic Setup with Individual Slash Commands

```lua
-- In your CodeCompanion opts function
local vscode_copilot_loader = require("codecompanion._extensions.vscode_copilot_loader")
vscode_copilot_loader.setup({
  project_level = true,          -- Scan .vscode/copilot-chat/ etc.
  user_level = true,             -- Scan user VSCode directories
  create_slash_commands = true,  -- Create individual slash commands
  debug = false,                 -- Disable debug logging
})
local vscode_copilot_prompts = vscode_copilot_loader.get_prompts()

-- Merge into prompt_library
prompt_library = vim.tbl_deep_extend("force", {
  -- Your existing prompts...
}, vscode_copilot_prompts)
```

## Example 2: Real-world VSCode Copilot Files

### File: `.vscode/copilot-chat/dotfiles-expert.json`
```json
{
  "name": "dotfiles-expert",
  "description": "Expert in dotfiles configuration and management", 
  "prompt": "You are an expert in dotfiles management. You specialize in shell configuration, editor setup, and development environment automation. Provide detailed, practical advice for dotfiles setup and maintenance."
}
```
**Becomes**: `/dotfiles_expert` slash command

### File: `.vscode/copilot-chat/lua-neovim.md`
```markdown
# Lua Neovim Development Assistant

You are a Lua development expert specializing in Neovim plugin development and configuration.

## Your Expertise
- Lua language patterns and best practices
- Neovim API and plugin architecture  
- Configuration management and modularization
- Performance optimization
- Error handling and debugging

Provide working code examples and explain your reasoning.
```
**Becomes**: `/lua_neovim` slash command

## Example 3: Conditional Configuration

```lua
-- Dynamic configuration based on environment
local function setup_vscode_copilot()
  local is_work_project = vim.fn.getcwd():match("/work/") ~= nil
  
  local opts = {
    project_level = true,
    create_slash_commands = true,
    debug = false,
  }
  
  if is_work_project then
    -- Work environment: only project files for privacy
    opts.user_level = false
    opts.custom_paths = {}
  else
    -- Personal projects: use all sources
    opts.user_level = true
    opts.custom_paths = {
      "~/personal-ai-prompts/",
      "~/.config/copilot-modes/",
    }
  end
  
  local vscode_copilot_loader = require("codecompanion._extensions.vscode_copilot_loader")
  vscode_copilot_loader.setup(opts)
  return vscode_copilot_loader.get_prompts()
end
```

## Example 4: Disabling Slash Commands (Variable Mode)

```lua
-- If you prefer the old variable approach, disable slash commands
local vscode_copilot_loader = require("codecompanion._extensions.vscode_copilot_loader")
vscode_copilot_loader.setup({
  create_slash_commands = false,  -- Disable individual slash commands
})
-- No prompts will be created, extension will be inactive
```

## Example 5: Team Configuration File

### File: `.vscode/copilot-chat/team-standards.json`
```json
{
  "name": "team-standards",
  "description": "Team coding standards and practices",
  "prompt": "You are a senior developer familiar with our team's coding standards. Follow these practices:\n\n- Use TypeScript for all new features\n- Write comprehensive tests\n- Follow our ESLint configuration\n- Document public APIs\n- Use conventional commits\n\nProvide feedback that aligns with these standards."
}
```
**Usage**: `/team_standards` in any CodeCompanion chat

## Example 6: Custom Paths for Specialized Prompts

```lua
local vscode_copilot_loader = require("codecompanion._extensions.vscode_copilot_loader")
vscode_copilot_loader.setup({
  project_level = true,
  user_level = false,
  create_slash_commands = true,
  custom_paths = {
    -- Project-specific AI prompts
    "docs/ai-prompts/",
    ".ai-assistants/",
    
    -- Language-specific prompts
    "lua-assistants/",
    "python-assistants/",
    
    -- Global user prompts  
    "~/.config/ai-prompts/",
  },
})
```

## Example 7: Using Slash Commands in Practice

Once your VSCode Copilot files are discovered, use them naturally in chats:

```
# In CodeCompanion chat window:

/lua_neovim
How do I create a custom Neovim operator that works with text objects?

/dotfiles_expert  
What's the best way to organize zsh configuration across multiple machines?

/team_standards
Review this TypeScript function for adherence to our coding standards.
```

## Example 8: Integration with Existing Extensions

```lua
-- The VSCode Copilot extension works alongside other extensions
extensions = {
  rules_loader = {
    enabled = true,
    opts = { 
      paths = { 
        "AGENTS.md", 
        ".github/copilot-instructions.md", -- This is handled by rules_loader
        ".github/instructions/",
      }
    },
    callback = "codecompanion._extensions.rules_loader",
  },
  -- VSCode Copilot loader is called manually in opts function
}

-- Individual slash commands can still reference rules
-- Example slash command usage:
-- /dotfiles_expert
-- 
-- Please help with my zsh config. 
-- Also consider these project rules: #{rules}
```

## Tips and Best Practices

1. **Organize by Purpose**: Create focused assistants like `/code_reviewer`, `/doc_writer`, `/debugger`
2. **Use Descriptive Names**: File names become slash commands, so use clear names
3. **Combine with Variables**: Slash commands work great with `#{buffer}`, `#{ls}`, `#{rules}`
4. **Start Small**: Begin with 2-3 specialized assistants and expand gradually
5. **Team Consistency**: Commit `.vscode/copilot-chat/` files to share assistants with your team
6. **Test Your Prompts**: Verify that your JSON files are valid and prompts work as expected