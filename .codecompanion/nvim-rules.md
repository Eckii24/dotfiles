# Neovim Configuration Rules

When working on Neovim configuration:

## Lua Best Practices
- Use proper module structure with `local M = {}`
- Include proper type annotations with `---@` comments
- Use `vim.opt` for option setting in modern Neovim
- Prefer `vim.keymap.set()` over deprecated mapping functions

## Plugin Configuration
- Use lazy loading when appropriate
- Include proper dependencies
- Set up keymaps in plugin specs when possible
- Use `opts` tables for simple plugin configuration

## Performance
- Avoid excessive autocmds
- Use `vim.schedule()` for non-critical UI updates
- Consider startup time impact of plugins and configurations