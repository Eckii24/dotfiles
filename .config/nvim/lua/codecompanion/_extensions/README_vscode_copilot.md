# VSCode Copilot Extension for CodeCompanion

This extension loads VSCode GitHub Copilot prompts and custom chat modes into CodeCompanion as individual slash commands.

## Features

- **Individual slash commands**: Each VSCode Copilot file becomes its own prompt accessible via slash commands
- **Project-level support**: Automatically discovers VSCode Copilot files in your project
- **User-level support**: Scans user-specific VSCode directories across platforms (Windows, macOS, Linux)
- **Cross-platform compatibility**: Automatically detects the correct user paths for each OS
- **Configurable**: Enable/disable slash command creation and customize scanning paths
- **Focused scanning**: Excludes GitHub Copilot instructions (handled by rules_loader extension)

## Configuration

The extension is configured in your CodeCompanion setup:

```lua
-- Load manually in opts function to merge prompts
local vscode_copilot_loader = require("codecompanion._extensions.vscode_copilot_loader")
vscode_copilot_loader.setup({
  project_level = true,          -- Enable scanning project-level files
  user_level = true,             -- Enable scanning user-level files
  create_slash_commands = true,  -- Create slash commands for each prompt
  custom_paths = {},             -- Additional custom paths to scan
  debug = false,                 -- Enable debug logging
})
```

### Configuration Options

- `project_level` (boolean, default: true): Enable scanning project-level VSCode Copilot files
- `user_level` (boolean, default: true): Enable scanning user-level VSCode directories
- `create_slash_commands` (boolean, default: true): Create slash commands for each discovered prompt
- `custom_paths` (array, default: []): Additional custom paths to scan for Copilot files
- `debug` (boolean, default: false): Enable debug logging to see what files are discovered

## Scanned Locations

### Project Level (when `project_level = true`)
- `.vscode/copilot-chat/`
- `.vscode/copilot/`
- `.copilot/`

**Note**: GitHub Copilot instructions (`.github/copilot-instructions.md`) are **NOT** included as they're handled by the existing `rules_loader` extension.

### User Level (when `user_level = true`)

**Windows:**
- `%APPDATA%\Code\User\copilot-chat\`
- `%APPDATA%\Code\User\copilot\`
- `%USERPROFILE%\.vscode\copilot\`

**macOS:**
- `~/Library/Application Support/Code/User/copilot-chat/`
- `~/Library/Application Support/Code/User/copilot/`
- `~/.vscode/copilot/`

**Linux:**
- `~/.config/Code/User/copilot-chat/`
- `~/.config/Code/User/copilot/`
- `~/.vscode/copilot/`

## Usage

### Slash Commands

Each discovered VSCode Copilot file becomes an individual slash command:

- `.vscode/copilot-chat/dotfiles-expert-mode.json` → `/dotfiles_expert`
- `.vscode/copilot-chat/lua-expert.md` → `/lua_expert`
- `.vscode/copilot-chat/code-reviewer.json` → `/code_reviewer`

Use them in CodeCompanion by typing the slash command:
```
/dotfiles_expert
/lua_expert
```

### Example Workflow

1. Create a VSCode Copilot chat mode file:
```json
// .vscode/copilot-chat/dotfiles-expert.json
{
  "name": "dotfiles-expert",
  "description": "Expert in dotfiles configuration and management",
  "prompt": "You are an expert in dotfiles management. You specialize in shell configuration, editor setup, and development environment automation. Provide detailed, practical advice for dotfiles setup and maintenance."
}
```

2. The extension automatically discovers this file and creates a `/dotfiles_expert` slash command

3. Use the slash command in CodeCompanion chats:
```
/dotfiles_expert

How should I organize my zsh configuration?
```

## File Format Support

The extension supports:
- **Markdown files** (`.md`): Loaded as-is
- **JSON files** (`.json`): Extracts `prompt`, `description`, or `instructions` fields
- **Text files** (`.txt`): Loaded as-is

## Integration

The extension integrates seamlessly with existing CodeCompanion features:
- Works alongside the `rules_loader` extension for comprehensive context
- Individual prompts can be combined with variables like `#{buffer}`, `#{ls}`, `#{rules}`
- Slash commands are discoverable through CodeCompanion's command palette