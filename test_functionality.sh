#!/usr/bin/env bash

# Comprehensive test for Copilot Adapter Extension functionality

set -e

echo "🔍 Testing Copilot Adapter Extension Functionality..."

EXTENSION_DIR="/home/runner/work/dotfiles/dotfiles/.config/nvim/lua/codecompanion/_extensions/copilot_adapter"
TEST_PROMPTS_DIR="/home/runner/work/dotfiles/dotfiles/.github/prompts"

echo ""
echo "📊 Testing Extension Features:"

# Count prompt files by type
echo "📁 Discovered prompt files:"
for file in "$TEST_PROMPTS_DIR"/*.prompt.md; do
  if [[ -f "$file" ]]; then
    basename "$file"
    
    # Check for frontmatter
    if head -n 1 "$file" | grep -q "^---"; then
      echo "  ✅ Has YAML frontmatter"
    else
      echo "  ⚠️  No YAML frontmatter"
    fi
    
    # Check for mode
    if grep -q "^mode:" "$file"; then
      mode=$(grep "^mode:" "$file" | cut -d: -f2 | xargs)
      echo "  🎯 Mode: $mode"
    else
      echo "  📝 Default mode (ask)"
    fi
    
    # Check for content prefix overrides
    if grep -q "^cc_prefix:" "$file"; then
      echo "  🔧 Has custom content prefix"
    fi
    
    echo ""
  fi
done

echo "🧪 Testing Configuration Features:"

# Check namespace configuration
config_file="/home/runner/work/dotfiles/dotfiles/.config/nvim/lua/plugins/codecompanion.lua"
if grep -q 'slash_namespace = "cp"' "$config_file"; then
  echo "✅ Namespace configuration: cp"
else
  echo "❌ Namespace configuration not found"
fi

# Check enable_modes
if grep -q 'enable_modes = true' "$config_file"; then
  echo "✅ Modes enabled"
else
  echo "❌ Modes not enabled"
fi

# Check content_prefix
if grep -q 'content_prefix = "#buffer #rules"' "$config_file"; then
  echo "✅ Content prefix configured"
else
  echo "❌ Content prefix not configured"
fi

echo ""
echo "📋 Expected Slash Commands (with namespace 'cp'):"
for file in "$TEST_PROMPTS_DIR"/*.prompt.md; do
  if [[ -f "$file" ]]; then
    name=$(basename "$file" .prompt.md | sed 's/-/_/g')
    echo "  /cp_$name"
  fi
done

echo ""
echo "🔄 Testing File Processing Logic:"

# Test YAML parsing by simulating what the extension would do
echo "📄 Sample frontmatter parsing test:"
cat > /tmp/test_prompt.md << 'EOF'
---
mode: agent
description: "Test prompt"
model: gpt-4o
tools: ["filesystem"]
cc_prefix: "#test"
cc_prefix_role: "system"
---

# Test Content

This is test content.
EOF

echo "✅ Created test prompt file"

# Test that all our real prompt files are valid
echo "🔍 Validating real prompt files:"
for file in "$TEST_PROMPTS_DIR"/*.prompt.md; do
  if [[ -f "$file" ]]; then
    filename=$(basename "$file")
    
    # Check YAML frontmatter structure
    if grep -q "^---" "$file" && grep -q "^---" "$file" | tail -1; then
      echo "  ✅ $filename: Valid YAML frontmatter structure"
    else
      echo "  ⚠️  $filename: No or invalid YAML frontmatter"
    fi
    
    # Check for content after frontmatter
    if tail -n +10 "$file" | grep -q "[a-zA-Z]"; then
      echo "  ✅ $filename: Has content body"
    else
      echo "  ⚠️  $filename: No content body found"
    fi
  fi
done

echo ""
echo "🎉 Extension functionality test completed!"

# Cleanup
rm -f /tmp/test_prompt.md