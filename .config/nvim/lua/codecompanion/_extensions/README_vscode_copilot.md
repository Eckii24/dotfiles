# VSCode Copilot Extension for CodeCompanion

This extension loads VSCode GitHub Copilot prompts and custom chat modes into CodeCompanion, making them available as context variables.

## Features

- **Project-level support**: Automatically discovers VSCode Copilot files in your project
- **User-level support**: Scans user-specific VSCode directories across platforms (Windows, macOS, Linux)
- **Cross-platform compatibility**: Automatically detects the correct user paths for each OS
- **Configurable scanning**: Enable/disable project or user level scanning
- **Chat mode support**: Optionally include VSCode custom chat modes as prompts
- **Custom prefix**: Add custom prefixes (like `#buffer`, `#rules`, `#tools`) to all loaded prompts

## Configuration

The extension is configured in your CodeCompanion setup:

```lua
vscode_copilot_loader = {
  enabled = true,
  opts = {
    project_level = true,      -- Enable scanning project-level files
    user_level = true,         -- Enable scanning user-level files
    include_chat_modes = false, -- Don't include chat modes by default
    custom_prefix = "",        -- No custom prefix by default
    custom_paths = {},         -- Additional custom paths to scan
  },
  callback = "codecompanion._extensions.vscode_copilot_loader",
},
```

### Configuration Options

- `project_level` (boolean, default: true): Enable scanning project-level VSCode Copilot files
- `user_level` (boolean, default: true): Enable scanning user-level VSCode directories
- `include_chat_modes` (boolean, default: false): Include files that appear to be chat mode definitions
- `custom_prefix` (string, default: ""): Prefix to add to all loaded prompts (e.g., "#buffer #rules")
- `custom_paths` (array, default: []): Additional custom paths to scan for Copilot files

## Scanned Locations

### Project Level (when `project_level = true`)
- `.github/copilot-instructions.md`
- `.github/copilot/`
- `.vscode/copilot-chat/`
- `.vscode/copilot/`
- `.copilot/`
- `copilot-instructions.md`

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

### In Chat Variables

Use the `#{vscode_copilot}` or `#{copilot}` variable in your prompts:

```lua
prompts = {
  {
    role = "user",
    content = [[
#{vscode_copilot}

Please help me with the current task using the VSCode Copilot context above.
]],
  },
}
```

### Example with Custom Prefix

```lua
vscode_copilot_loader = {
  enabled = true,
  opts = {
    custom_prefix = "#buffer #rules #tools",
    include_chat_modes = true,
  },
  callback = "codecompanion._extensions.vscode_copilot_loader",
},
```

This will add "#buffer #rules #tools" to the beginning of every loaded Copilot prompt.

## File Format Support

The extension supports:
- **Markdown files** (`.md`): Loaded as-is with optional prefix
- **JSON files** (`.json`): Attempts to extract `prompt`, `description`, or `instructions` fields
- **Text files** (`.txt`): Loaded as-is with optional prefix

## Example Files

### Project-level instruction file (`.github/copilot-instructions.md`)
```markdown
# Project Copilot Instructions

You are working on a dotfiles repository. Follow these guidelines:
- Use consistent formatting
- Test changes thoroughly
- Document configuration options
```

### Chat mode file (`.vscode/copilot-chat/expert-mode.json`)
```json
{
  "name": "expert-mode",
  "description": "Expert coding assistant",
  "prompt": "You are an expert software engineer specializing in best practices and clean code.",
  "instructions": "Provide detailed explanations and suggest improvements."
}
```

## Integration

The extension integrates seamlessly with existing CodeCompanion features and can be used alongside other extensions like `rules_loader` for comprehensive context management.