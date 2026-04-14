# Agent Harness Permission Systems Research

**Date:** 2026-04-06  
**Scope:** How major agent harnesses (Claude Code, Cline, Aider, OpenAI Codex, MCP) handle permissions and safety guardrails

---

## Executive Summary

Permission systems in agent harnesses follow **three core architectural patterns**:

1. **Human-in-the-loop approval** (Cline, Aider) – Explicit GUI/CLI confirmation for each risky operation
2. **Configuration-driven allowlists** (Cline command permissions) – Glob/regex patterns for automatic allow/deny
3. **Protocol-level abstraction** (MCP) – Tool definitions with schema validation, no enforcement layer

**Key tradeoff:** Safety vs. autonomy. More restrictions require more user interaction (approval fatigue); fewer restrictions increase risk.

---

## 1. Cline (VS Code Extension)

**Architecture:** Human-in-the-loop approval UI + environment-variable command permissions  
**Source:** https://github.com/cline/cline  
**Prominence:** ~12K stars, widely used for agentic code generation

### 1.1 Permission Model

Cline implements **two layers**:

#### Layer 1: UI-Based Approval (Human-in-the-loop)
- **Every file change** and **terminal command** requires explicit user approval in the UI
- Diff view for file edits (user can edit inline before approving)
- Restore checkpoints to roll back to previous workspace states
- Controlled through VS Code webview (no programmatic bypass)

#### Layer 2: Command Permissions (Configuration-driven)
- **Environment variable:** `CLINE_COMMAND_PERMISSIONS` (JSON)
- **Configuration structure:**
  ```json
  {
    "allow": ["pattern1", "pattern2"],
    "deny": ["pattern3"],
    "allowRedirects": false
  }
  ```
- **Scope:** Command execution only (not file operations)

### 1.2 Command Permission Implementation

**Source:** `src/core/permissions/CommandPermissionController.ts`

#### Key Features:
1. **Shell parsing:** Uses `shell-quote` library to parse command segments
2. **Segment validation:** Each segment in chained commands (&&, ||, |, ;) validated separately
3. **Dangerous character detection:**
   - Backticks (command substitution)
   - Newlines outside quotes (command separator injection)
   - Unicode line separators (U+2028, U+2029, U+0085)
   - Carriage returns (injection vectors)

4. **Subshell handling:** Recursively validates command substitutions `$(...)` and `(...)`
5. **Redirect control:** Can block `>`, `>>`, `<` operators via `allowRedirects` flag

#### Pattern Matching:
```typescript
// Wildcard patterns (simpler than glob)
"*" → matches any sequence (including newlines)
"?" → matches single character
"gh pr comment *" → matches `gh pr comment 123 --body-file /tmp/file.txt`
```

#### Security Considerations:
- **Precedence:** Deny rules checked before allow rules
- **Fail-safe:** If `allow` rules defined but no match → deny by default
- **Backward compatibility:** No env var set → all commands allowed
- **Subshell injection:** Backticks in double quotes are blocked (execution context)

### 1.3 File Permissions

**Currently:** Manual approval only (no configuration-driven allowlist)  
**Potential:** Could implement path-based allow/deny via config

---

## 2. Aider (Terminal CLI)

**Architecture:** Interactive confirmation prompts + git integration for safety  
**Source:** https://github.com/Aider-AI/aider  
**Prominence:** ~5.7M pip installs, leading agentic pair-programming tool

### 2.1 Permission Model

Aider uses **confirmation groups** and **git-based safety**:

#### User Confirmation Workflow
```python
class ConfirmGroup:
    preference: str = None      # Remember user choice (always/yes/no/never)
    show_group: bool = True
```

**Decision tree for risky operations:**
```
1. Detect operation type (file edit, URL add, test/lint fix suggestion)
2. Group similar operations (e.g., "add URLs?" shows all detected URLs)
3. Ask once per group, with memory of user's previous choice
4. Support "always", "yes once", "no", "never" options
```

#### Examples from codebase:
```python
# URL additions
if self.io.confirm_ask(
    "Add URL to the chat?", 
    subject=url, 
    group=group, 
    allow_never=True
):
    inp += "\n\n" + url

# File edits
if not self.io.confirm_ask("Allow edits to file that has not been added to the chat?", subject=path):
    self.io.tool_output(f"Skipping edits to {path}")
    return False

# Test/lint fixes
ok = self.io.confirm_ask("Attempt to fix lint errors?")
```

#### Git Integration (Safety Layer)
- **Automatic commits** with sensible commit messages after edits
- **Familiar git tools** to diff/revert/manage AI changes
- **Easy auditing:** Each AI operation creates a commit
- **Rollback:** User can `git reset` to any prior state

### 2.2 Interactive Input System

**Source:** `aider/io.py`  
```python
class InputOutput:
    num_error_outputs = 0
    num_user_asks = 0
    clipboard_watcher = None
    bell_on_next_input = False
    notifications_command = None
```

**Features:**
- History-aware input (remembers user preferences)
- Bell notification on wait
- Support for vi/emacs editing modes
- Fancy terminal rendering or plain mode

### 2.3 File Editing Guardrail

```python
def allowed_to_edit(self, path):
    # 1. Check if path exists
    # 2. Check if path has been added to chat
    # 3. Confirm before editing untouched files
    # 4. Require confirmation for new file creation
```

---

## 3. Model Context Protocol (MCP)

**Spec:** https://modelcontextprotocol.io  
**Python SDK:** https://github.com/modelcontextprotocol/python-sdk  
**Prominence:** Standard protocol for Claude/tool integration; industry direction

### 3.1 Architecture

MCP is a **protocol-level abstraction** with **no built-in enforcement**:

```
┌─────────────────┐
│  Claude/Client  │
└────────┬────────┘
         │ (JSON-RPC)
    ┌────▼────────────────────────┐
    │  MCP Protocol Messages      │
    │  - resources                │
    │  - tools (with schema)      │
    │  - prompts                  │
    │  - sampling requests        │
    └────┬────────────────────────┘
         │
    ┌────▼──────────────┐
    │  MCP Server       │
    │  (stdio/HTTP/SSE) │
    └─────────────────┘
```

### 3.2 Tool Definition (No Permission Enforcement)

```python
@mcp.tool()
def execute_command(command: str) -> str:
    """Execute a shell command.
    
    Args:
        command: The shell command to execute
    
    Returns:
        The command output
    """
    return subprocess.run(command, shell=True, capture_output=True, text=True).stdout
```

**Schema validation only:**
- Parameter types and descriptions
- No runtime permission checks at protocol level
- **Permission enforcement is client responsibility** (Claude Desktop, Cline, etc.)

### 3.3 Key Design Decisions

1. **Separation of concerns:** Protocol defines contract, client enforces policy
2. **No authentication in spec:** Delegated to transport layer (stdio secure by default)
3. **Sampling:** Clients can call `request_sampling()` to ask Claude for advice on uncertain operations
4. **No audit log mandate:** Implementers decide logging/monitoring strategy

---

## 4. Pi Coding Agent (Local Context)

**Location:** `/Users/matthias.eck/.pi/agent/extensions/guardrails/`

### 4.1 Current Implementation

**Types:** `guardrails/types.ts`
```typescript
interface PathsConfig {
  denyRead?: string[];
  allowWrite?: string[];        // Undefined = unrestricted
  denyWrite?: string[];
}

interface BashConfig {
  deny?: string[];              // Commands to deny
}
```

**Config Loading:** `guardrails/config.ts`
- Global: `~/.pi/agent/guardrails.json`
- Project-local: `<cwd>/.pi/guardrails.json` (takes precedence)
- Cached by file mtime
- Validation on load with error reporting

### 4.2 Guards Implemented

- **bash-guard.ts** – Bash command execution protection
- **path-guard.ts** – File read/write path restrictions
- **dirty-repo-guard.ts** – Git state checks
- **input-notify.ts** – User notification extension
- **shell-ast.ts** – Shell script parsing utilities

---

## 5. Design Patterns & Tradeoffs

### 5.1 Permission Models (Spectrum)

| Model | Example | Safety | Autonomy | Overhead |
|-------|---------|--------|----------|----------|
| **No permissions** | Raw API | Low | High | None |
| **Protocol schema** | MCP tools | Medium | Medium-High | Low |
| **Allowlist (static)** | Cline env vars | High | Medium | Config time |
| **Confirmation (per-op)** | Aider/Cline UI | Very High | Low | High (approval fatigue) |
| **Combination** | Cline + UI | Very High | Medium | Medium |

### 5.2 Implementation Strategies

#### Strategy A: Environment Variable + Parsing (Cline)
**Pros:**
- Easy to configure (JSON in env var)
- No UI friction for allowed operations
- Shell-aware (detects injection vectors)
- Supports complex logic (&&, ||, |, subshells)

**Cons:**
- Only applies to terminal commands
- Requires operator knowledge (glob patterns)
- Difficult to debug (parsing failures silent)

#### Strategy B: Confirmation Prompts (Aider)
**Pros:**
- User always aware
- Supports "remember my choice" (reduce fatigue)
- Works for any operation type (files, URLs, tests)
- Git integration provides audit trail

**Cons:**
- Approval fatigue for repeated operations
- Blocks on user input (dev loop slower)
- Requires interactive session

#### Strategy C: Git-Based Rollback (Aider)
**Pros:**
- Enables "try and revert" workflow
- Clear audit trail (git log)
- Integrates with familiar tools

**Cons:**
- Only protects repository state (not system files, network)
- Post-hoc (doesn't prevent, recovers)

#### Strategy D: Protocol-Level Abstraction (MCP)
**Pros:**
- Flexible (client defines policy)
- Composable (combine with other security layers)
- Client-centric (works with any tool ecosystem)

**Cons:**
- No built-in enforcement
- Requires client implementation
- No standard audit mechanism

### 5.3 Risk Categories & Coverage

| Risk | Cline | Aider | MCP | Pi Guardrails |
|------|-------|-------|-----|--------------|
| **Command injection** | ✓ (env var) | Manual | ✗ | ✓ (planned) |
| **Unintended file edits** | ✓ (UI) | ✓ (confirm) | ✗ | ✓ (path rules) |
| **Destructive operations** | ✓ (redirect block) | ~ (git fallback) | ✗ | ✓ (deny patterns) |
| **Network access** | ✗ | ✗ | ✗ | ~ (partial) |
| **Privilege escalation** | Partial (sudo block) | ✗ | ✗ | ✗ |
| **Data exfiltration** | ✗ | ✗ | ✗ | Partial (log) |

---

## 6. Concrete Design Patterns for Local Guardrails Extension

### 6.1 Recommended Architecture

```
┌──────────────────────────────────┐
│   Pi Extension (guardrails)       │
├──────────────────────────────────┤
│  1. Config Layer                 │
│     - Load from JSON             │
│     - Merge global + project     │
│     - Validate & cache           │
├──────────────────────────────────┤
│  2. Rule Engine                  │
│     - Path matching (glob)       │
│     - Bash parsing (AST)         │
│     - Custom validators          │
├──────────────────────────────────┤
│  3. Decision Layer               │
│     - ALLOW / CONFIRM / DENY     │
│     - Reason + evidence          │
├──────────────────────────────────┤
│  4. Audit Layer                  │
│     - Log all decisions          │
│     - Track user choices         │
└──────────────────────────────────┘
```

### 6.2 Config-Driven Permission Model

**Three-state decision tree:**

```typescript
interface GuardDecision {
  allowed: boolean;              // final decision
  requiresConfirmation: boolean; // true = ask user, false = block
  reason: string;
  matchedPattern?: string;
}

type CheckResult = 
  | { status: "allow" }
  | { status: "confirm"; reason: string }
  | { status: "deny"; reason: string };
```

### 6.3 Configuration Schema

```json
{
  "timeout": 300000,
  "paths": {
    "denyRead": ["**/.env*", "**/secrets/**"],
    "allowWrite": ["src/**", "docs/**"],
    "denyWrite": ["**/.git/**", "**/node_modules/**"]
  },
  "bash": {
    "deny": ["rm -rf *", "sudo *", "dd *"],
    "allowRedirects": false
  },
  "network": {
    "denyHosts": ["*.internal.company.com"],
    "denyPorts": [22, 3389]
  },
  "custom": {
    "confirmOnModifiedRepo": true,
    "auditLogFile": "~/.pi/guardrails-audit.log"
  }
}
```

### 6.4 Decision Workflow

```typescript
async function checkOperation(
  op: Operation,
  config: GuardrailsConfig
): Promise<OperationDecision> {
  // 1. Check deny rules first (fail-safe)
  if (matchesDenyPattern(op, config)) {
    return { status: "deny", reason: "Matched deny pattern" };
  }

  // 2. Check allow rules
  if (config.allowList && !matchesAllowPattern(op, config)) {
    return { status: "confirm", reason: "Not in allowlist" };
  }

  // 3. Check risk heuristics
  if (isHighRisk(op)) {
    return { status: "confirm", reason: "High-risk operation" };
  }

  // 4. Return allow
  return { status: "allow" };
}
```

### 6.5 Audit & Logging

```typescript
interface AuditEntry {
  timestamp: ISO8601;
  operation: Operation;
  decision: OperationDecision;
  matchedPatterns: string[];
  userConfirmed?: boolean;
  outcome: "success" | "failed" | "blocked";
  error?: string;
}
```

---

## 7. Recommended Patterns for Pi Guardrails

### Pattern 1: Layered Enforcement
1. **Config layer** – Quick deny/allow via patterns
2. **Heuristic layer** – Risk scoring (destructive commands, sensitive paths)
3. **Confirmation layer** – Ask user for uncertain cases
4. **Audit layer** – Log all decisions for review

### Pattern 2: Progressive Restriction
```
Allow everything (permissive default)
  → Add deny patterns (defensive)
  → Add allow patterns (strict mode)
  → Enable confirmation (interactive)
  → Enable audit logging (forensics)
```

### Pattern 3: Context-Aware Decisions
```
Same operation → Different decision based on:
- Repository state (dirty = more caution)
- Operation history (repeated = pattern recognition)
- Time of day (deployments restricted to business hours)
- User confirmation history (learned preferences)
```

### Pattern 4: Escape Hatches
```
// User can override for justified use cases
GUARDRAILS_OVERRIDE_TOKEN=<secret> pi <command>
GUARDRAILS_CONFIRM_ALL=true pi <command>
```

---

## 8. Security Considerations

### 8.1 Common Vulnerabilities

1. **Quote bypasses:** Backticks in double quotes, $(...) substitution
   - **Mitigation:** Parse shell AST, detect dangerous contexts

2. **Newline injection:** Commands split across lines
   - **Mitigation:** Detect newlines outside quotes (Cline does this)

3. **Pipe to commands:** `| xargs rm`, `| sh`, etc.
   - **Mitigation:** Warn on pipe-to-execution, optional block

4. **Subshell escapes:** `cmd && $(malicious)`, `(cd /; rm -rf *)`
   - **Mitigation:** Recursively validate subshell contents

5. **Unicode tricks:** U+2028 (line separator), etc.
   - **Mitigation:** Normalize and detect (Cline blocks these)

### 8.2 Defense in Depth

```
Level 1: Syntax analysis (detect injection vectors)
Level 2: Semantic analysis (understand intent)
Level 3: Heuristics (risk scoring)
Level 4: User approval (human judgment)
Level 5: Audit logging (forensic review)
```

---

## 9. Implementation Checklist for Local Extension

- [ ] **Config Loading**
  - [ ] JSON schema validation
  - [ ] Glob pattern matching (use `minimatch`)
  - [ ] Project-local override semantics
  - [ ] Mtime-based caching

- [ ] **Bash Security**
  - [ ] Shell quote parsing (use `shell-quote`)
  - [ ] Dangerous character detection
  - [ ] Subshell validation
  - [ ] Redirect operator handling
  - [ ] Test against injection vectors

- [ ] **Path Security**
  - [ ] Glob pattern matching for read/write
  - [ ] Symlink resolution
  - [ ] Relative path normalization
  - [ ] Case-sensitivity handling (OS-dependent)

- [ ] **Confirmation UX**
  - [ ] User-friendly prompts
  - [ ] "Remember my choice" support
  - [ ] Timeout handling
  - [ ] Keyboard shortcuts (approve all, deny all)

- [ ] **Audit & Observability**
  - [ ] Structured logging (JSON)
  - [ ] Decision rationale captured
  - [ ] Pattern match details
  - [ ] Performance metrics

---

## 10. URLs & References

### Official Documentation
- **MCP Specification:** https://modelcontextprotocol.io
- **MCP Python SDK:** https://github.com/modelcontextprotocol/python-sdk

### Open Source Implementations
- **Cline (VS Code):** https://github.com/cline/cline
  - Permissions module: `src/core/permissions/CommandPermissionController.ts`
  - 12K+ stars, active maintenance
  
- **Aider (Terminal CLI):** https://github.com/Aider-AI/aider
  - Confirmation logic: `aider/io.py` + `aider/coders/base_coder.py`
  - 5.7M pip installs, established project

### Related Projects
- **shell-quote (npm):** NPM package for shell argument parsing
- **minimatch (npm):** Glob pattern matching library

### Documentation Sites (Content Sources)
- Cline README: https://github.com/cline/cline/blob/main/README.md
- Aider README: https://github.com/Aider-AI/aider/blob/main/README.md

---

## 11. Lessons & Anti-Patterns

### ✓ Do's
- Use glob patterns for path rules (familiar, powerful)
- Parse shell into AST (catches injection attacks)
- Log audit trail (post-hoc analysis)
- Support "deny by default" mode (strict security)
- Allow environment variable override (for automation/CI)

### ✗ Don'ts
- Don't trust user input for permission decisions
- Don't silently fail permission checks
- Don't hardcode paths (make configurable)
- Don't require code restart for config changes
- Don't block on user confirmation for automated runs

---

**End of Research Document**
