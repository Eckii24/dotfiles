# Agent Harness Permission Systems Research

**Completed**: 2026-04-06  
**Scope**: Permission/guardrail systems across Claude Code, Cline, Aider, and pi  
**Output**: 3 comprehensive documents with patterns, tradeoffs, and implementation guidance

## 📚 Research Documents

### 1. **AGENT_PERMISSION_SYSTEMS_RESEARCH.md** (Primary)
**Length**: 500+ lines | **Audience**: Deep dive  
**Contains**:
- Detailed architecture of each tool (Pi, Cline, Aider, Claude Code)
- 4 concrete examples from pi's extension library
- Comparative design patterns table
- 5 abstract design patterns (A-E) with code examples
- Implementation recommendations for pi guardrails
- Key design decisions framework
- Tradeoff analysis (latency vs safety, friction vs automation)

**Read this for**: Understanding the full landscape, making architectural decisions

### 2. **GUARDRAILS_QUICK_START.md** (Quick Reference)
**Length**: ~300 lines | **Audience**: Implementers  
**Contains**:
- Three approaches compared (Pi, Aider, Cline)
- Five concrete patterns with code snippets
- MVP roadmap (4 phases)
- Key design decision questions
- Failure mode decision tree
- Three ways to start (30 min, 2 hours, 1 day)

**Read this for**: Immediate implementation guidance, decision-making

### 3. **This File** (README_RESEARCH.md)
**Length**: This document | **Audience**: Navigation  
**Contains**: Overview and pointer to all documents

---

## 🎯 Quick Answers

### What's the best approach for pi guardrails?
**Pattern A: Rule-Based Blocking** (start here)
- Define rules in JSON or TypeScript
- Match against tool calls (regex, path patterns)
- Prompt user for approval via `ctx.ui`
- Log all decisions for audit trail
- Fail-safe by default (block in non-UI mode)

Rationale: Balances safety (high), latency (medium), friction (low), and flexibility

### What are the key tradeoffs?
| Dimension | Pi (Patterns) | Cline (Always-Ask) | Aider (Git-Based) |
|-----------|-----------|-----------|-----------|
| Safety | 🟢 High | 🟢🟢 Very High | 🟡 Medium |
| Speed | 🟡 Medium | 🔴 Slow | 🟢 Fast |
| User Friction | 🟢 Low | 🔴 High | 🟢 Low |
| Flexibility | 🟢🟢 High | 🟡 Medium | 🟡 Medium |

### What should my MVP include?
**Phase 1** (week 1):
- Rule-based blocking with JSON config
- Dangerous patterns: `rm -rf`, `sudo`, `chmod 777`
- Protected paths: `.env`, `.git/`, `.aws/`, `node_modules/`
- Interactive confirmation via `ctx.ui.select`
- Audit log to `~/.pi/agent/guardrails-audit.json`
- Non-UI mode: default block all

---

## 🔍 Research Methodology

### Sources
1. **Pi Documentation** (internal)
   - Extension API: `@mariozechner/pi-coding-agent`
   - Example extensions: `permission-gate.ts`, `protected-paths.ts`, etc.
   - Full API surface: `/docs/extensions.md`

2. **Cline** (public GitHub)
   - https://github.com/cline/cline
   - README: "Human-in-the-loop GUI to approve every file change and terminal command"
   - VSCode integration, diff visualization, workspace snapshots

3. **Aider** (public)
   - https://github.com/paul-gauthier/aider
   - https://aider.chat/docs/
   - Git-based change control, `/undo` reversion, auto-commits

4. **Claude Code** (limited public info)
   - Anthropic documentation (some behind auth)
   - Enterprise features: audit trails, SSO, private networking
   - Likely similar to Cline's pre-execution approval model

5. **OpenAI Agents** (blocked by Zscaler)
   - https://platform.openai.com/docs/guides/agents
   - Could not access (behind enterprise security gateway)

### Limitations
- Claude Code and OpenAI Agents have limited public documentation
- Some Cline/Aider docs behind authentication walls
- Inferred some patterns based on product descriptions

---

## 🏗️ Architecture Patterns Identified

### Pattern Spectrum: Pre-Execution vs Post-Execution

```
Pre-Execution (Blocking)      Post-Execution (Auditing)
│                              │
Pi (patterns)                  Aider (git)
Cline (always-ask)             
Claude Code (approval)         

← Safety          Speed →
← Friction        Automation →
```

### Rule Storage Spectrum

```
Code-Based (TypeScript)        Config-Based (JSON/YAML)
│                              │
Pi (extension code)            Aider (.aider.conf.yml)
                               Cline (UI settings)

← Expressiveness               Updateability →
← Coding required              GUI friendly →
```

### Failure Mode Spectrum

```
Block by Default              Allow by Default
│                              │
Pi (fail-safe)                 Aider (optimistic)
Cline (explicit)               

← Safety                        Speed →
← Conservative                 Trusting →
```

---

## 🎓 Key Insights

### Insight 1: The Approval Fatigue Trap
Both Cline and always-ask approaches suffer from approval fatigue.
Solutions:
- Approval history with temporary auto-trust (Pattern C)
- Hierarchical levels (Pattern B)
- Score-based risk assessment (advanced)

### Insight 2: Git as a Natural Permission Model
Aider's approach proves that git can be a permission system:
- Changes are traceable (who, what, when)
- Changes are reversible (`git revert`, `/undo`)
- Changes require attention but not pre-approval
- Familiar to developers (no new mental model)

### Insight 3: Composability is Powerful
Pi's extension model allows multiple guardrails to coexist:
- `permission-gate.ts` (dangerous commands)
- `protected-paths.ts` (file protection)
- `confirm-destructive.ts` (session safety)
- `dirty-repo-guard.ts` (git state)

They don't conflict; they stack. This is rare and valuable.

### Insight 4: Non-UI Mode is Critical
All tools must handle non-UI environments (CI, batch, headless):
- Pi: Blocks by default (fail-safe)
- Cline: N/A (IDE-only, always has UI)
- Aider: Allows by default (optimistic)
- Claude Code: Likely fails or blocks

Recommendation: Make this configurable.

### Insight 5: Audit Trail is Table Stakes
Enterprise adoption requires audit logs:
- Who approved what, when, why
- Compliance reporting
- Incident investigation
- Access control verification

Include from MVP.

---

## 💡 Design Decision Framework

### D1: Timing
**Question**: Approve before or after execution?
- **Before**: Safer but slower (Cline, Pi, Claude Code)
- **After**: Faster but requires discipline (Aider)
- **Recommendation for pi**: Before (safer, aligns with fail-safe model)

### D2: Rule Format
**Question**: How should users define rules?
- **TypeScript code**: Full power, requires reload
- **JSON config**: Easy to update, limited expressiveness
- **DSL**: Balanced but complex
- **UI forms**: Approachable but limited
- **Recommendation for pi**: JSON primary, TypeScript fallback

### D3: Non-UI Behavior
**Question**: What happens in CI/batch/headless mode?
- **Block all**: Safe but frustrating
- **Allow all**: Fast but risky
- **Config-driven**: Flexible
- **Recommendation for pi**: Block all (fail-safe), add `--guardrails-ci-mode` flag for override

### D4: User Feedback
**Question**: How do you inform users of decisions?
- **Modal dialog**: Guarantees visibility, interrupts workflow
- **Notification**: Gentle, but users might miss it
- **Log file**: No interruption, good for audit
- **Recommendation for pi**: Modal for critical (block), notification for warnings, always log

### D5: Performance
**Question**: How do you evaluate rules efficiently?
- **Eager**: Check all rules always (thorough but slow)
- **Early exit**: Check in priority order, stop on first match (fast)
- **Caching**: Cache results for identical inputs (risky)
- **Recommendation for pi**: Priority-order early exit, no caching (avoid drift)

---

## 🚀 Implementation Roadmap

### Phase 1: Core Blocking (Foundation)
- [ ] Rule-based blocking system
- [ ] Pattern matching (regex on commands, path globs on files)
- [ ] Interactive UI confirmation
- [ ] Audit logging
- [ ] Non-UI mode support

**Estimate**: 1 week | **Complexity**: Medium

### Phase 2: Smart Defaults (UX)
- [ ] Pre-configured rules for common dangers
- [ ] Protected paths library
- [ ] Config file support
- [ ] Notification system
- [ ] Documentation

**Estimate**: 1 week | **Complexity**: Low

### Phase 3: Approval History (Friction Reduction)
- [ ] Track approval history per rule
- [ ] Auto-approval after N approvals in time window
- [ ] Hierarchical approval levels
- [ ] Override mechanisms (`--no-guardrails`)

**Estimate**: 1 week | **Complexity**: Low

### Phase 4: Advanced (Future)
- [ ] Git snapshot + rollback
- [ ] Score-based risk assessment
- [ ] Team/role-based approval
- [ ] Compliance reporting
- [ ] ML-based pattern detection

**Estimate**: 2+ weeks | **Complexity**: High

---

## 📖 How to Use These Documents

### For Decision Making
1. Read **GUARDRAILS_QUICK_START.md** → Section "Key Design Decisions"
2. Answer Q1-Q4 for your use case
3. Review tradeoff sections in **AGENT_PERMISSION_SYSTEMS_RESEARCH.md**
4. Decide on your MVP scope

### For Implementation
1. Read **GUARDRAILS_QUICK_START.md** → Section "MVP Implementation Roadmap"
2. Copy pattern structure from pi examples (`permission-gate.ts`, etc.)
3. Implement Phase 1 first
4. Iterate based on feedback

### For Deep Understanding
1. Read **AGENT_PERMISSION_SYSTEMS_RESEARCH.md** → All sections in order
2. Study the code examples for each pattern (A-E)
3. Review comparative tables
4. Understand the tradeoff landscape

---

## 📎 Reference to Existing Pi Code

All example extensions located at:
```
/Users/matthias.eck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/examples/extensions/
```

Key permission-related examples:
1. **permission-gate.ts** — Blocks: rm -rf, sudo, chmod 777
2. **protected-paths.ts** — Blocks: Writes to .env, .git, node_modules
3. **confirm-destructive.ts** — Blocks: Session switch/fork with unsaved work
4. **dirty-repo-guard.ts** — Blocks: Context switch with uncommitted changes

All use `pi.on("tool_call")` or lifecycle events to intercept and block.

---

## ✅ Checklist for Next Steps

Before Implementation:
- [ ] Read GUARDRAILS_QUICK_START.md
- [ ] Make design decisions (D1-D5)
- [ ] Review pi extension examples
- [ ] Decide on MVP scope

During Phase 1:
- [ ] Implement rule engine
- [ ] Add 5 default rules
- [ ] Test with manual scenarios
- [ ] Verify non-UI mode behavior
- [ ] Set up audit logging

After Phase 1:
- [ ] Gather user feedback
- [ ] Iterate on rule set
- [ ] Plan Phase 2 scope
- [ ] Document for team

---

## Questions?

Refer to the section in:
- **"How do I block rm -rf?"** → GUARDRAILS_QUICK_START.md, Pattern A
- **"What about approval fatigue?"** → AGENT_PERMISSION_SYSTEMS_RESEARCH.md, Section 7 (Tradeoffs)
- **"How does Cline handle this?"** → AGENT_PERMISSION_SYSTEMS_RESEARCH.md, Section 2
- **"What's the best approach?"** → GUARDRAILS_QUICK_START.md, "Three Approaches Compared"

All three documents are designed to cross-reference and provide different entry points.
