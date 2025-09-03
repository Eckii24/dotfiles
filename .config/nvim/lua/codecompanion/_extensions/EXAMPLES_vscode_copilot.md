# Advanced Usage Examples

This file demonstrates advanced usage patterns for the VSCode Copilot extension.

## Example 1: Integration with Multiple Context Sources

```lua
-- In your CodeCompanion configuration
extensions = {
  rules_loader = {
    enabled = true,
    opts = { 
      paths = { 
        "AGENTS.md", 
        ".github/instructions/",
        "~/.global-rules/"
      }
    },
    callback = "codecompanion._extensions.rules_loader",
  },
  vscode_copilot_loader = {
    enabled = true,
    opts = {
      project_level = true,
      user_level = true,
      include_chat_modes = true,
      custom_prefix = "#buffer #ls #rules",
    },
    callback = "codecompanion._extensions.vscode_copilot_loader",
  },
}

-- Prompt using both extensions
prompt_library = {
  ["Full Context Assistant"] = {
    strategy = "chat",
    description = "Assistant with comprehensive context from all sources",
    prompts = {
      {
        role = "system",
        content = [[
## Project Rules and Guidelines
#{rules}

## VSCode Copilot Context  
#{vscode_copilot}

## Current Context
- Buffer: #{buffer}
- Project Structure: #{ls}

You have access to comprehensive context. Use it to provide the most relevant assistance.
]],
      },
    },
  },
}
```

## Example 2: Conditional Configuration Based on Environment

```lua
-- Dynamic configuration based on environment
local function get_copilot_config()
  local is_work_project = vim.fn.getcwd():match("/work/") ~= nil
  
  if is_work_project then
    -- Work environment: only project files, no user files for privacy
    return {
      project_level = true,
      user_level = false,
      include_chat_modes = false,
      custom_prefix = "#buffer #rules",
    }
  else
    -- Personal projects: use all sources
    return {
      project_level = true,
      user_level = true,
      include_chat_modes = true,
      custom_prefix = "#buffer #ls #rules #tools",
      custom_paths = {
        "~/personal-prompts/",
        "~/.config/ai-prompts/",
      },
    }
  end
end

extensions = {
  vscode_copilot_loader = {
    enabled = true,
    opts = get_copilot_config(),
    callback = "codecompanion._extensions.vscode_copilot_loader",
  },
}
```

## Example 3: Custom File Processing

```lua
-- Custom paths for specialized prompts
extensions = {
  vscode_copilot_loader = {
    enabled = true,
    opts = {
      project_level = true,
      user_level = false,
      include_chat_modes = true,
      custom_prefix = "",
      custom_paths = {
        -- Project-specific AI prompts
        "docs/ai/",
        "prompts/",
        ".ai-prompts/",
        
        -- Language-specific prompts
        "lua-prompts/",
        "python-prompts/",
        
        -- Global user prompts
        "~/.config/copilot-prompts/",
        "~/dotfiles/ai-prompts/",
      },
    },
    callback = "codecompanion._extensions.vscode_copilot_loader",
  },
}
```

## Example 4: Multiple Specialized Assistants

```lua
prompt_library = {
  ["Code Review Assistant"] = {
    strategy = "chat",
    description = "Specialized for code reviews with Copilot context",
    opts = { short_name = "code_review" },
    prompts = {
      {
        role = "system",
        content = [[
#{vscode_copilot}

You are a code review specialist. Focus on:
- Code quality and best practices
- Security considerations  
- Performance implications
- Maintainability

Current context: #{buffer}
Project structure: #{ls}
]],
      },
    },
  },
  
  ["Documentation Writer"] = {
    strategy = "chat", 
    description = "Specialized for writing documentation with context",
    opts = { short_name = "doc_writer" },
    prompts = {
      {
        role = "system",
        content = [[
#{vscode_copilot}

You are a technical documentation specialist. Consider:
- Current codebase structure: #{ls}
- Active file: #{buffer}
- Project guidelines: #{rules}

Write clear, comprehensive documentation that helps users understand and use the code effectively.
]],
      },
    },
  },
  
  ["Debugging Assistant"] = {
    strategy = "chat",
    description = "Specialized for debugging with full context",
    opts = { short_name = "debug" },
    prompts = {
      {
        role = "system", 
        content = [[
#{vscode_copilot}

You are a debugging specialist with access to:
- Current code: #{buffer}
- Project context: #{ls}
- Project rules: #{rules}

Help identify issues, suggest fixes, and explain debugging strategies.
]],
      },
    },
  },
}
```

## Example 5: Team Configuration

```lua
-- Shared team configuration that can be committed to the repository
-- Place in .github/codecompanion-config.lua or similar

local team_config = {
  vscode_copilot_loader = {
    enabled = true,
    opts = {
      project_level = true,          -- Always scan project files
      user_level = false,            -- Skip user files for consistency
      include_chat_modes = true,     -- Include team-defined chat modes
      custom_prefix = "#buffer #ls", -- Standard context for team
      custom_paths = {
        ".github/ai-prompts/",       -- Team prompts
        "docs/development/ai/",      -- Development guidelines
      },
    },
    callback = "codecompanion._extensions.vscode_copilot_loader",
  },
}

return team_config
```

## Tips and Best Practices

1. **Start Simple**: Begin with default settings and gradually customize
2. **Use Prefixes Wisely**: Add relevant context variables that enhance prompt effectiveness
3. **Consider Privacy**: Disable user-level scanning in shared/work environments
4. **Organize Files**: Keep prompts organized in logical directories
5. **Test Configurations**: Verify that your paths exist and contain relevant content
6. **Document Usage**: Add comments explaining your configuration choices