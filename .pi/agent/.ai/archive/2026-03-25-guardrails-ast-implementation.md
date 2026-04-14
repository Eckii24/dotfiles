# Guardrails: AST Support + Allow-for-Session

## Plan

### 1. Add `shell-ast.ts` — shfmt-based AST parser
- Call `shfmt -tojson` via `execFileSync` to parse bash commands into an AST
- Define TypeScript types for the shfmt JSON AST (File, Stmt, CallExpr, BinaryCmd, etc.)
- `parseShellAST(command)` — returns AST or null on failure
- `walkShellCommands(ast, callback)` — recursively walk all command nodes
- `wordToString(word)` — extract literal string from a Word node
- `extractRedirTargets(stmt)` — get redirect target paths from a statement
- Detect shfmt availability at startup, cache result

### 2. Modify `bash-guard.ts` — hybrid AST + fallback
- Try AST parsing first via `parseShellAST()`
- If AST available: walk commands via AST, extract command names, args, redirect targets
  - Apply existing deny command checks
  - Apply existing file read/write detection (adapted to use AST-resolved words)
  - Recursively parse `bash -c "..."`, `eval "..."` via inner AST
  - Track `cd` for cwd changes
- If AST unavailable: fall back to existing string-based parser (no changes)
- Result type unchanged (BashCheckResult with violations)

### 3. Modify `index.ts` — allow-for-session
- Track session-level allowed patterns: `Set<string>` of exact commands
- Track session-level allowed command patterns: commands that matched but user said "allow for session"
- For bash violations, use `ctx.ui.custom()` instead of `ctx.ui.confirm()` to offer 3 options:
  - `y/Enter`: allow this time
  - `a`: allow for session (adds the command pattern to session allowlist)
  - `n/Esc`: deny
- Session allowlist is checked before running violations check

### 4. Add `types.ts` — new types
- Add `ShellASTAvailable` flag
- Add session allow types

## Progress
- [x] shell-ast.ts — shfmt AST parser with full type definitions, walker, word resolver
- [x] bash-guard.ts — hybrid AST + fallback, all detection logic working with both paths
- [x] index.ts — allow-for-session with custom TUI dialog (y/a/n), session allowlist, countdown timer
- [x] types.ts — no changes needed (existing types sufficient)
- [x] Testing — all 11 test cases pass, false positive elimination confirmed
