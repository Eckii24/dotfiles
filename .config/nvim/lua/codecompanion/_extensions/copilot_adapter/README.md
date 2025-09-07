# CodeCompanion Copilot Adapter Extension

This extension imports GitHub Copilot prompt files and VS Code custom chat modes into CodeCompanion, with configurable content prefix injection.

## Features

- **Auto-discovery**: Finds `.prompt.md` and `.chatmode.md` files in workspace and global locations
- **YAML frontmatter parsing**: Supports standard Copilot metadata (`mode`, `description`, `model`, `tools`)
- **Content prefix injection**: Adds configurable prefixes to prompts at runtime
- **Header adjustment**: Automatically adjusts markdown headers to avoid conflicts with chat buffer
- **Slash commands**: Registers prompts as `/command_name` slash commands
- **Multi-platform support**: Handles Windows, macOS, and Linux global paths
- **VS Code custom chat modes**: Supports `.chatmode.md` files for custom chat modes

## Configuration

Add to your CodeCompanion config:

```lua
extensions = {
  copilot_adapter = {
    enabled = true,
    opts = {
      enable_prompts = true,        -- Import .prompt.md files
      enable_chatmodes = true,      -- Import .chatmode.md files
      content_prefix = "#buffer #rules", -- Text prepended to all prompts
      content_adjustments = {
        adjust_headers = true,      -- Adjust markdown headers to avoid chat conflicts
      },
      paths = {
        workspace = true,           -- Include ./.github/prompts/
        global = true,             -- Include platform-specific global paths
        extra = {                  -- Additional custom paths
          "~/my-prompts/",
        },
      },
      slash_namespace = "cp",      -- Prefix commands: /cp_code_review
    },
    callback = "codecompanion._extensions.copilot_adapter",
  },
}
```

## File Discovery

### Workspace Paths
- `./.github/prompts/*.prompt.md`
- `./.github/prompts/*.chatmode.md`

### Global Paths

Supports both VS Code and VS Code Insiders:

**Windows:**
- `%APPDATA%/Code/User/prompts/`
- `%APPDATA%/Code/User/.github/prompts/`
- `%APPDATA%/Code - Insiders/User/prompts/`
- `%APPDATA%/Code - Insiders/User/.github/prompts/`

**macOS:**
- `~/Library/Application Support/Code/User/prompts/`
- `~/Library/Application Support/Code/User/.github/prompts/`
- `~/Library/Application Support/Code - Insiders/User/prompts/`
- `~/Library/Application Support/Code - Insiders/User/.github/prompts/`

**Linux:**
- `$XDG_CONFIG_HOME/Code/User/prompts/` (or `~/.config/Code/User/prompts/`)
- `$XDG_CONFIG_HOME/Code/User/.github/prompts/` (or `~/.config/Code/User/.github/prompts/`)
- `$XDG_CONFIG_HOME/Code - Insiders/User/prompts/` (or `~/.config/Code - Insiders/User/prompts/`)
- `$XDG_CONFIG_HOME/Code - Insiders/User/.github/prompts/` (or `~/.config/Code - Insiders/User/.github/prompts/`)

## Prompt File Format

```markdown
---
mode: ask                    # ask, edit, agent (for .prompt.md)
description: "Code review"   # Description for the prompt
model: gpt-4o               # Preferred model
tools: ["filesystem"]       # Available tools
cc_prefix: "#buffer #rules" # Override content prefix
---

# Your Prompt Title

Your prompt content goes here...
```

For VS Code custom chat modes (`.chatmode.md`), use the same format but VS Code will treat them as custom chat modes.

## Content Prefix

The content prefix is injected into every prompt to provide context:

- **String**: Static text prepended to prompts
- **Per-file override**: Use `cc_prefix` in YAML frontmatter to override per file

## Header Adjustment

CodeCompanion uses markdown H2 headers (`##`) to separate user, system, and LLM messages in the chat buffer. To prevent prompt headers from breaking the chat display, the extension automatically adjusts all markdown headers in prompts by making them two levels deeper:

- `# Header 1` becomes `### Header 1` (H1 → H3)
- `## Header 2` becomes `#### Header 2` (H2 → H4)
- `### Header 3` becomes `##### Header 3` (H3 → H5)

This can be disabled by setting `content_adjustments.adjust_headers = false` in the configuration.

## Usage

After loading, prompts become available as slash commands:

- `/code_review` - Basic code review
- `/debug` - Debug assistant  
- `/refactor` - Code refactoring
- `/test_generator` - Generate tests

With namespace `cp`:
- `/cp_code_review`
- `/cp_debug`
- etc.

## API

```lua
local copilot_adapter = require("codecompanion._extensions.copilot_adapter")

-- List loaded prompts
local prompts = copilot_adapter.list_prompts()

-- List loaded chatmodes
local chatmodes = copilot_adapter.list_chatmodes()

-- Reload with new options
copilot_adapter.reload({ enable_chatmodes = false })
```