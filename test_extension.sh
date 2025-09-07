#!/usr/bin/env bash
set -e
echo "🔍 Testing Copilot Adapter Extension..."
EXTENSION_DIR="/home/runner/work/dotfiles/dotfiles/.config/nvim/lua/codecompanion/_extensions/copilot_adapter"
TEST_PROMPTS_DIR="/home/runner/work/dotfiles/dotfiles/.github/prompts"
echo "📁 Checking file structure..."
if [[ -f "$EXTENSION_DIR/init.lua" ]]; then
    echo "✅ Main extension file exists"
else
    echo "❌ Main extension file missing"
    exit 1
fi
if [[ -f "$EXTENSION_DIR/yaml_parser.lua" ]]; then
    echo "✅ YAML parser exists"
else
    echo "❌ YAML parser missing"
    exit 1
fi
if [[ -f "$EXTENSION_DIR/path_utils.lua" ]]; then
    echo "✅ Path utils exists"
else
    echo "❌ Path utils missing"
    exit 1
fi
if [[ -d "$TEST_PROMPTS_DIR" ]]; then
    echo "✅ Test prompts directory exists"
    echo "📝 Found prompt files:"
    find "$TEST_PROMPTS_DIR" -name "*.prompt.md" -exec basename {} \;
else
    echo "❌ Test prompts directory missing"
    exit 1
fi
CONFIG_FILE="/home/runner/work/dotfiles/dotfiles/.config/nvim/lua/plugins/codecompanion.lua"
if grep -q "copilot_adapter" "$CONFIG_FILE"; then
    echo "✅ Extension integrated in configuration"
else
    echo "❌ Extension not found in configuration"
    exit 1
fi
echo "🎉 All checks passed! Extension structure is valid."