---
mode: agent
description: "Generate comprehensive unit tests"
model: gpt-4o
tools: ["filesystem", "terminal"]
cc_prefix: "#buffer #ls"
cc_prefix_role: "system"
cc_prefix_when: "register"
---

# Test Generator

Generate comprehensive unit tests for the provided code. I will:

1. **Analyze** the code structure and functionality
2. **Identify** all testable units and edge cases
3. **Generate** complete test suites with:
   - Unit tests for individual functions
   - Integration tests for workflows
   - Edge case testing
   - Mock configurations
4. **Ensure** proper test organization and documentation

Please provide the code you want me to test.