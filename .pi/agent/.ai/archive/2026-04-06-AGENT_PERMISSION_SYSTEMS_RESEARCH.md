# Agent Harness Permission Systems: Research Summary

## Overview

Permission systems in agent harnesses control what AI agents can do without human intervention. This research examines design patterns from **pi**, **Cline**, **Aider**, and available public documentation.

---

## 1. PI (Mariozechner) - Extension-Based Permission Model

### Architecture
- **Event-Driven Interception**: Uses `tool_call` event listeners to inspect and approve/reject tool invocations before execution
- **Fail-Safe Blocking**: Returns `{ block: true, reason: string }` to prevent tool execution
- **Interactive Prompts**: Integrates with UI layer (`ctx.ui.confirm`, `ctx.ui.select`) for user approval
- **Non-Interactive Fallback**: Blocks dangerous operations when `ctx.hasUI === false` (fail-safe by default)

### Key Permission Examples

#### 1.1 Permission Gate (Dangerous Command Blocking)
**File**: `permission-gate.ts`
```typescript
const dangerousPatterns = [
  /\brm\s+(-rf?|--recursive)/i,  // rm -rf
  /\bsudo\b/i,                   // sudo
  /\b(chmod|chown)\b.*777/i      // chmod/chown 777
];

pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash") return;
  
  const command = event.input.command as string;
  const isDangerous = dangerousPatterns.some((p) => p.test(command));
  
  if (isDangerous) {
    if (!ctx.hasUI) {
      return { block: true, reason: "Dangerous command blocked (no UI)" };
    }
    const choice = await ctx.ui.select(`⚠️ Dangerous command: ${command}. Allow?`, ["Yes", "No"]);
    if (choice !== "Yes") {
      return { block: true, reason: "Blocked by user" };
    }
  }
});
```

**Design Pattern**:
- Pattern matching on tool input
- Regex-based command classification
- Interactive confirmation with fallback denial

#### 1.2 Protected Paths (Resource Blocking)
**File**: `protected-paths.ts`
```typescript
const protectedPaths = [".env", ".git/", "node_modules/"];

pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "write" && event.toolName !== "edit") return;
  
  const path = event.input.path as string;
  const isProtected = protectedPaths.some((p) => path.includes(p));
  
  if (isProtected) {
    ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
    return { block: true, reason: `Path "${path}" is protected` };
  }
});
```

**Design Pattern**:
- Path matching on tool inputs
- Silent blocking for protected resources
- User notification of blocked actions

#### 1.3 Destructive Action Confirmation
**File**: `confirm-destructive.ts`
- Blocks session clearing/switching without confirmation
- Checks for unsaved work (user messages) before allowing session switch
- Uses `session_before_switch` and `session_before_fork` events (lifecycle guards)

#### 1.4 Git State Guardrail
**File**: `dirty-repo-guard.ts`
- Prevents context switching (fork/switch) with uncommitted changes
- Runs `git status` to check for dirty files
- Prompts user to commit before proceeding or cancel operation

### Strengths
✅ Composable: Multiple extensions can stack permission rules  
✅ Flexible: Pattern-based or semantic rules  
✅ Fail-safe by default in non-UI modes  
✅ Fine-grained event access (tool_call, session_before_*, etc.)  
✅ Built-in UI integration for approval flows  

### Tradeoffs
⚠️ **Extension security**: Extensions run with full system permissions—user must trust all installed extensions  
⚠️ **Performance**: Every tool call flows through all registered handlers (potential latency)  
⚠️ **Rule maintenance**: Patterns must be updated manually (e.g., new dangerous commands)  
⚠️ **Non-interactive mode**: Defaults to denial, may require CI/CD workarounds  

---

## 2. CLINE (VS Code Extension) - Human-in-the-Loop Approval

### Architecture
- **Always-Ask Model**: "Human-in-the-loop GUI to approve every file change and terminal command"
- **IDE Integration**: VSCode extension provides native UI for approval
- **Diff Visualization**: Shows changes before approval for explicit review
- **Timeline Tracking**: All changes recorded in file timeline for undo/revert

### Permission Flow
1. Agent proposes file edit → Diff view presented to user
2. User can: Accept / Edit / Revert / Provide feedback
3. Agent proposes terminal command → User prompted for approval
4. Agent proposes browser action → User can monitor and override

### Key Features
- Real-time terminal output monitoring
- Browser capability with screenshot/console capture
- "Proceed While Running" for long-running commands
- Workspace snapshots for rollback between steps

### Strengths
✅ **Explicit approval**: Every action requires human sign-off  
✅ **Visual review**: Diff interface for code changes  
✅ **Undo/rollback**: VSCode timeline integration  
✅ **IDE-native**: Integrated into existing developer workflow  
✅ **Tool diversity**: File edit, bash, browser all gated  

### Tradeoffs
⚠️ **IDE-specific**: Only available in VSCode (not portable)  
⚠️ **Latency**: Must wait for user approval on every tool call  
⚠️ **Context switching**: User must interrupt workflow for each approval  
⚠️ **No progressive trust**: Every action, even "safe" ones, requires approval  
⚠️ **Approval fatigue**: May lead to accidental approvals of dangerous operations  

---

## 3. AIDER - Git-Based Change Control

### Architecture
- **Commit-Based Workflow**: Every change from aider is auto-committed with descriptive messages
- **Git as Audit Trail**: All changes traceable and reversible via git history
- **Dirty File Protection**: Commits user changes before aider edits (keeps work separate)
- **Undo Command**: `/undo` instantly reverts last AI change

### Permission Mechanisms
1. **Passive Review**: Changes visible in diffs *after* committed
2. **Reversion**: User can `git revert` or `/undo` any aider commit
3. **Selective Application**: User can cherry-pick specific aider commits
4. **Pre-commit Hooks**: Optional `--git-commit-verify` to validate changes before accepting

### Commit Marking
- Commits authored by aider are marked: `(aider)` appended to author/committer
- Supports Conventional Commits format for structured commit messages
- Optional co-authored-by trailer

### Configuration
```bash
--no-auto-commits          # Stop auto-committing (risky)
--no-dirty-commits         # Don't protect dirty files
--no-git                   # Disable git entirely (very risky)
--git-commit-verify        # Run pre-commit hooks
```

### Strengths
✅ **Non-blocking**: Changes proceed immediately, review happens async  
✅ **Reversible**: Any change can be undone via git tools user already knows  
✅ **Audit trail**: Full history of what AI did and when  
✅ **Familiar workflow**: Git is standard for devs  
✅ **Selective application**: Cherry-pick good changes, discard bad ones  
✅ **Low latency**: No approval waits during task execution  

### Tradeoffs
⚠️ **Post-hoc review**: User must remember to check diffs/undos  
⚠️ **Change acceptance**: No explicit approval step—easy to forget reviewing changes  
⚠️ **Irreversible workflows**: Some systems can't easily undo (DB, deployed code, etc.)  
⚠️ **Non-git projects**: Doesn't work in non-version-controlled directories  
⚠️ **Requires git discipline**: User must actively manage git history  

---

## 4. CLAUDE CODE (Anthropic) - Limited Public Information

### Known Details (from README)
- "Human-in-the-loop GUI to approve every file change and terminal command" (similar to Cline)
- Part of Anthropic's enterprise ecosystem
- Provides "agentic coding capabilities" with Claude Sonnet

### Inference from Anthropic Patterns
- Likely uses similar approval-before-execution model to Cline
- Probably integrates computer use capabilities (screenshot/scroll/click)
- Enterprise version offers: SSO, audit trails, private networking, self-hosted options

---

## 5. COMPARATIVE DESIGN PATTERNS

### Pattern 1: Permission Timing

| Tool | Timing | Pros | Cons |
|------|--------|------|------|
| **Pi** | Before execution | Prevents mistakes | Approval fatigue |
| **Cline** | Before execution | Explicit control | Workflow interruption |
| **Aider** | After execution | Fast, unblocking | Requires post-hoc review |
| **Claude Code** | Before execution | Safe by default | Latency |

### Pattern 2: Approval Mechanism

| Tool | Mechanism | Scope | Flexibility |
|------|-----------|-------|-------------|
| **Pi** | Regex patterns + UI prompts | Per tool/command | High (composable) |
| **Cline** | Binary approval + diff review | Per action | Medium (binary) |
| **Aider** | Git history + undo | Per change set | High (post-hoc) |

### Pattern 3: Rule Definition

| Tool | How Rules Are Defined | Who Can Update | Frequency |
|------|----------------------|-----------------|-----------|
| **Pi** | Extension TypeScript | Developer | Per-session reload |
| **Cline** | Configuration + hardcoded | Team via UI settings | Session-based |
| **Aider** | Config file options | Team via `.aider.conf.yml` | Per-run |

### Pattern 4: Failure Mode

| Tool | When UI Unavailable | When Blocked | User Intent |
|------|-------------------|--------------|------------|
| **Pi** | Block by default (fail-safe) | Exception + error message | Conservative |
| **Cline** | N/A (IDE-only) | Stop and notify | Controlled |
| **Aider** | Proceeds (optimistic) | Commit + user reviews later | Trust-based |

---

## 6. CONCRETE DESIGN PATTERNS FOR GUARDRAILS EXTENSION

### Pattern A: Pattern-Based Pre-Execution Blocking
**Suitable for**: pi-style extensions  
**Rules**: Regex matching on tool inputs  
**Approval**: Interactive confirmation via UI  
**Example**:
```typescript
const rules = [
  { pattern: /\brm\s+-rf/, severity: "critical", prompt: "Delete recursively?" },
  { pattern: /\bsudo\b/, severity: "high", prompt: "Run as root?" },
  { pattern: /\.env/, severity: "medium", prompt: "Modify secrets?" }
];
```

### Pattern B: Hierarchical Approval Levels
**Suitable for**: Enterprise/team workflows  
**Levels**:
- Auto-approve: Safe patterns (read-only, lint, format)
- User-approve: Dangerous but explicit (file write, command run)
- Block: Prohibited (certain directories, system commands)

**Implementation**:
```typescript
enum ApprovalLevel {
  AUTO_ALLOW = 0,      // Trusted operations
  REQUIRE_UI = 1,      // Need user confirmation
  REQUIRE_ADMIN = 2,   // Require elevated approval
  BLOCK = 3            // Always denied
}
```

### Pattern C: Contextual Trust Levels
**Suitable for**: Long-running workflows  
**Idea**: Grant temporary trust after initial approval
```typescript
interface TrustContext {
  grantedUntil: Date;
  operationType: string;
  approvalCount: number;
}

// After user approves 3 safe operations, temporarily auto-approve same type
```

### Pattern D: Git Snapshot + Rollback
**Suitable for**: Complex operations  
**Idea**: Combine pi's blocking with aider's git workflow
```typescript
// Before potentially dangerous operation
await pi.exec("git", ["stash"]);
// Run operation
// If problems detected, revert: git stash pop
```

### Pattern E: Audit Logging
**Suitable for**: All harnesses (especially enterprise)
```typescript
interface AuditEntry {
  timestamp: Date;
  action: string;
  tool: string;
  input: string;
  approved: boolean;
  approver: string;
  reason?: string;
}
```

---

## 7. TRADEOFF MATRIX

### Latency vs. Safety

```
High Safety ─────────────────────── Low Safety
    ↑                                    ↓
Cline          Pi (strict)    Aider    Aider (optimistic)
Always Ask     Blocking       Git-based Review-Later
(User waits)   (Patterns)     (Undo)   (Fast)
```

### Implementation Complexity vs. Flexibility

```
Low Complexity ─────────────────── High Complexity
    ↑                                    ↓
Aider          Cline          Pi Extensions
(Git only)     (Hardcoded)    (Extensible patterns)
```

### User Friction vs. Automation

```
High Friction ─────────────────── Low Friction
    ↑                                    ↓
Cline          Pi             Aider (with trust)
(Every action) (Patterns)     (Async review)
```

---

## 8. IMPLEMENTATION RECOMMENDATIONS FOR PI GUARDRAILS EXTENSION

### Start Simple: Rule-Based Blocking

```typescript
interface GuardrailRule {
  name: string;
  toolName: string | string[];
  pattern?: RegExp;
  pathPattern?: string[];
  severity: "info" | "warn" | "block";
  action: "prompt" | "deny" | "log";
  description: string;
}

const defaultRules: GuardrailRule[] = [
  {
    name: "rm-recursive",
    toolName: "bash",
    pattern: /\brm\s+(-rf|--recursive)/,
    severity: "block",
    action: "prompt",
    description: "Recursive delete"
  },
  {
    name: "protected-paths",
    toolName: ["write", "edit"],
    pathPattern: [".env", ".git/*", "node_modules/*", ".aws/*"],
    severity: "block",
    action: "deny",
    description: "Protected file"
  }
];
```

### Mid-Level: Approval History + Auto-Trust

```typescript
interface ApprovalHistory {
  rulesApproved: Map<string, number>;  // rule -> count
  lastApprovalTime: Date;
  consecutiveApprovals: number;
}

// Auto-approve if user has approved this rule 3+ times in last 1 hour
```

### Advanced: Score-Based Approach

```typescript
function scoreTool(toolCall: ToolCall): { score: number; reason: string } {
  let score = 0;
  
  if (toolCall.toolName === "bash") score += 5;
  if (/\brm\b/.test(toolCall.input.command)) score += 10;
  if (/\bsudo\b/.test(toolCall.input.command)) score += 15;
  if (toolCall.input.command.includes("systemctl")) score += 8;
  
  return { score, reason: computeReason(score) };
}

// score < 3: auto-approve
// 3-7: prompt
// 7+: require elevated approval
```

---

## 9. KEY DESIGN DECISIONS FOR YOUR EXTENSION

### Decision 1: Blocking vs. Auditing
- **Blocking**: Prevent dangerous actions (fail-safe, conservative)
- **Auditing**: Log actions for review, allow all (trust-based)
- **Hybrid**: Score-based, with thresholds for each

**Recommendation**: Start with blocking (fail-safe), make configurable.

### Decision 2: Rule Format
- **Regex patterns**: Simple, flexible, but hard to maintain
- **Rule engine**: DSL or JSON, easier to manage, more complex
- **Code-based**: TypeScript rules, full expressiveness, requires coding

**Recommendation**: JSON-based config with fallback to extension code.

### Decision 3: Non-UI Behavior
- **Block all**: Safe but frustrating in CI
- **Allow all**: Fast but risky
- **Config-dependent**: Different modes for different contexts

**Recommendation**: Add `--guardrails-ci-mode` flag for non-UI environments.

### Decision 4: User Feedback
- **Modal prompt**: Interrupts workflow, guarantees user sees it
- **Notification**: Non-blocking, user might miss it
- **Log file**: Audit trail, no interruption

**Recommendation**: Modal for critical, notification for warnings, log for all.

### Decision 5: Performance
- **Eager evaluation**: Check all rules for every tool call (slower, comprehensive)
- **Early exit**: Check rules in priority order, stop on first match (faster)
- **Caching**: Cache rule results for identical inputs (risky, may miss drift)

**Recommendation**: Priority-order early exit with optional caching.

---

## 10. URLS AND SOURCES

### Pi Documentation
- Extension API: `@mariozechner/pi-coding-agent` package
- Examples: `examples/extensions/permission-gate.ts`, `protected-paths.ts`, etc.
- Location: `/Users/matthias.eck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`

### Cline
- GitHub: https://github.com/cline/cline
- Tagline: "Human-in-the-loop GUI to approve every file change and terminal command"
- Features: VSCode integration, diff visualization, workspace snapshots

### Aider
- GitHub: https://github.com/paul-gauthier/aider
- Website: https://aider.chat
- Docs: https://aider.chat/docs/ (config, git integration)
- Key Concept: Git-based change control with `/undo` reversal

### Claude Code
- Mentioned in Anthropic Claude docs (limited public info)
- Note: Public docs appear behind enterprise/auth walls

### OpenAI Agents
- Platform docs: https://platform.openai.com/docs/guides/agents (behind Zscaler)
- General guidance available in OpenAI API reference

---

## 11. SUMMARY TABLE: PERMISSION APPROACHES

| Approach | Tool(s) | When to Approve | Who Decides | Tool Integration | Reversibility |
|----------|---------|-----------------|-------------|------------------|---------------|
| **Pre-execution blocking** | Pi, Cline, Claude | Before run | User/extension | Pattern matching | N/A (prevented) |
| **Post-execution audit** | Aider | After run | User (via git) | Git + undo | High (git undo) |
| **Score-based gating** | Pi (custom) | Before run (threshold) | Extension logic | Dynamic scoring | N/A (prevented) |
| **Approval history** | Pi (custom) | Conditional on history | User + history | Stateful | N/A (prevented) |
| **Hierarchical levels** | Enterprise | Role-based | Team policy | Config-driven | Depends |

---

## Conclusion

**Key Takeaways**:

1. **Pre-execution blocking** (Cline, Pi) is safest but causes approval fatigue
2. **Post-execution auditing** (Aider) is fastest but requires discipline to review
3. **Pattern-based rules** (Pi) are flexible and can combine both strategies
4. **Contextual trust** (approval history, scoring) can reduce friction while maintaining safety
5. **Non-interactive mode** needs special handling (fail-safe or config-driven)

**For a pi guardrails extension**:
- Start with pattern-based blocking + interactive confirmation
- Add audit logging for compliance
- Support configuration via JSON or TypeScript
- Provide escape hatches for CI/CD (non-UI modes)
- Consider approval history for repeat-approved operations
