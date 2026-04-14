# Guardrails Extension Comparison

**Our extension** vs **@aliou/pi-guardrails** (v0.9.5)

## Architecture Overview

| Aspect | Ours | @aliou/pi-guardrails |
|---|---|---|
| Bash parsing | Hand-rolled regex/string splitting | AST via `@aliou/sh` + fallback to substring |
| Config system | 2 JSON files, simple merge | 3 scopes (global/local/memory), versioned, migrations |
| File protection | denyRead / allowWrite / denyWrite globs | Named policy rules with protection levels |
| Dangerous commands | Command name deny list | Pattern matching (substring/regex) + structural AST matchers |
| Settings UI | `/guardrails` dumps config | Full interactive `/guardrails:settings` TUI editor |
| Events | None | Custom events (`guardrails:blocked`, `guardrails:dangerous`) |
| Dependencies | None (pure TS) | `@aliou/sh`, `@aliou/pi-utils-settings` |

---

## Issues in Our Implementation

### 1. False Positives from String-Based Bash Parsing
Our parser splits on `&&`, `||`, `;`, `|` and then regex-matches command names. This can't distinguish between:
```bash
echo "don't run rm -rf /"   # harmless echo — we'd flag "rm"
grep "sudo" audit.log        # harmless grep — we'd flag "sudo"
```
The aliou extension parses the AST, so it knows `rm` is inside a quoted string argument to `echo`, not an actual command invocation.

### 2. No Control Flow Parsing
Our parser cannot handle:
- `if/then/else/fi`
- `for/do/done`, `while/do/done`
- `case/esac`
- Function declarations (`foo() { ... }`)
- Heredocs (`<<EOF ... EOF`)
- Process substitution (`<(...)`, `>(...)`)
- Arithmetic expressions `$((...))`

These structures are common in multi-line bash commands that agents generate. The aliou AST walker handles all of these via `walkCommands()` which traverses Pipeline, Logical, Subshell, Block, IfClause, ForClause, WhileClause, CaseClause, FunctionDecl, TimeClause, CoprocClause, CStyleLoop nodes.

### 3. No `onlyIfExists` Check
We trigger on pattern matches regardless of whether the file exists on disk. Accessing `.env.example` in a project without `.env` still raises warnings. The aliou extension defaults `onlyIfExists: true`, so policy rules only fire when the target file actually exists — dramatically reducing false positive noise.

### 4. No Protection Levels
Our system is binary: block or allow (with confirmation for deny patterns). The aliou extension has three levels:
- `none` — no restrictions
- `readOnly` — can read but not write/edit (and bash is also blocked for read-only files to prevent `sed -i`, etc.)
- `noAccess` — cannot read or write

This is more nuanced. A `.env` file should be `noAccess`, but a `database.sqlite` might be `readOnly`.

### 5. No "Allow for Session" Option
Every matching command requires re-confirmation. The aliou extension offers `y: allow · a: allow for session · n: deny`. Session-level allows are saved to the memory scope and take effect immediately. This is important for workflows where the same command pattern repeats (e.g., multiple `sudo` calls during setup).

### 6. No Auto-Deny Patterns
Everything requires confirmation. No way to configure patterns that should be silently blocked without prompting. The aliou extension has `autoDenyPatterns` that block immediately.

### 7. No Settings UI
We only dump the JSON config. The aliou extension has a full interactive TUI:
- Toggle features on/off
- Add/edit/delete policy rules with a wizard
- Pattern editor (glob + regex with toggle)
- Preset examples (secrets, SSH keys, AWS creds, k8s, certs, etc.)
- Scope picker (apply to global/local/memory)

### 8. No Config Versioning or Migration
If we change our config schema, existing configs break silently. The aliou extension has:
- Schema version field
- Migration pipeline (v0 → current, envFiles → policies, strip removed fields)
- Backup before migration
- Warning notifications for deprecated fields

### 9. No Custom Events
Other extensions can't react to our guardrails decisions. The aliou extension emits `guardrails:blocked` and `guardrails:dangerous` events, enabling integrations like sound effects, logging, or analytics.

### 10. No Command Explanation
Users see the raw command and violation list. The aliou extension optionally calls a small LLM to explain what the dangerous command does in 1-2 sentences, shown in the confirmation dialog.

### 11. Hand-Rolled Glob Matching
We implement `globToRegex()` ourselves. The aliou extension uses Node.js built-in `matchesGlob` from `node:path` (available since Node 22), which is more reliable.

### 12. No Glob Expansion for Bash Args
When a bash command uses `cat .env*`, we check the literal string `.env*` against patterns. The aliou extension uses `fd` to expand globs on the filesystem, catching cases where `*.env` would resolve to actual protected files.

### 13. No Named/ID-based Rule Deduplication
Our config merges arrays by full replacement (project overrides global). The aliou extension deduplicates policy rules by `id` across scopes — a project can override a specific global rule without replacing the entire ruleset.

---

## What's Better in Our Implementation

### 1. More Comprehensive File Operation Detection in Bash
We detect and check:
- Output redirections (`>`, `>>`, `2>`, `&>`) against denyWrite + allowWrite
- File write commands (`cp`, `mv`, `tee`, `dd`, `install`, `ln`, `rsync`, `scp`) with target extraction
- File read commands (`cat`, `head`, `tail`, `grep`, `awk`, `sed`, etc.) against denyRead

The aliou extension extracts all word arguments from commands and checks against policy patterns, but doesn't specifically model write vs. read operations. Their approach is broader (any arg that looks like a file) but less precise.

### 2. CWD Tracking Across `cd` Commands
We track `cd dir && some_command file.txt` and resolve `file.txt` relative to the new cwd. The aliou extension doesn't track cwd changes.

### 3. Symlink Protection
We canonicalize paths via `realpathSync()` and check both lexical and canonical paths. A symlink `safe-link → ~/.ssh/id_rsa` would be caught by checking the resolved path. The aliou extension doesn't canonicalize.

### 4. AllowWrite Whitelist
Our `allowWrite` pattern list is powerful for locking down: "only allow writes to `./**` and `/tmp/**`". The aliou extension doesn't have an explicit write whitelist — it focuses on protecting specific files rather than restricting where writes can go.

### 5. Wrapper/Prefix Command Unwrapping
We have detailed specs for unwrapping prefix commands (`time`, `nice`, `timeout`, `env`, etc.) and wrapper commands (`sudo`, `bash -c`, `exec`, `xargs`, etc.) with proper flag consumption. The aliou extension relies on the AST parser to handle these naturally, but `sudo` is only matched structurally as a top-level command name.

---

## Should We Use an AST Approach?

### Verdict: **Yes, hybrid approach recommended**

**The AST wins for command identification (avoiding false positives):**
```bash
# Our parser: flags "rm" as denied command
echo "Please don't rm -rf anything"

# AST parser: knows "rm" is a string literal in echo's args — no flag
```

This is the #1 practical issue. Agents frequently write echo/printf/log statements containing command names. Our string-based approach can't distinguish these from actual command invocations.

**Our approach wins for file operation detection:**
The AST gives you a clean tree of commands, but you still need to understand what each command *does* with its arguments. Our logic for:
- Detecting redirections and their targets
- Knowing that `cp`'s last arg is the destination
- Knowing that `dd of=X` writes to X
- Knowing that `tee` writes to its non-flag args

...would still be needed on top of the AST. The AST just gives you cleaner input.

### Recommended Approach
1. **Use `@aliou/sh`** (or similar) for parsing bash into an AST
2. **Walk the AST** with our existing detection logic adapted to work on AST nodes:
   - Check command names against deny list (from parsed `SimpleCommand.words[0]`)
   - Check redirect targets (from `SimpleCommand.redirects`)
   - Check file operation targets (from command-specific arg parsing)
3. **Fall back to our current string parsing** when AST parsing fails (heredocs, exotic syntax)
4. **Keep CWD tracking** (adapt to work across AST nodes in sequence)
5. **Keep symlink protection** via realpath canonicalization

---

## Functionality to Add (Priority Order)

### High Priority
1. **AST-based bash parsing** — Eliminates false positives on quoted strings
2. **`onlyIfExists` for deny patterns** — Reduces noise significantly
3. **"Allow for session"** — Critical UX for repetitive workflows
4. **Protection levels** (readOnly vs noAccess) — More nuanced access control
5. **Auto-deny patterns** — For commands that should never run (no confirmation)
6. **Use `node:path.matchesGlob`** — Replace hand-rolled glob-to-regex

### Medium Priority
7. **Named policy rules with IDs** — Better config composability across scopes
8. **Config versioning + migration** — Future-proof config schema changes
9. **Custom events** — Enable other extensions to react to guardrails
10. **Interactive settings UI** — Better UX than editing JSON
11. **Allowed patterns (exemptions)** — E.g., `.env.example` exempt from `.env*` deny

### Low Priority / Nice-to-Have
12. **Command explanation via LLM** — Helpful but adds latency + dependency
13. **Glob expansion for bash args** — Edge case but thorough
14. **Preset examples** — Good onboarding, not critical
15. **Memory scope** — Session-only overrides (pairs with "allow for session")
