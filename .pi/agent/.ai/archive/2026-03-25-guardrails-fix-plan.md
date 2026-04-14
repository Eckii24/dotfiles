# Guardrails Extension — Fix Plan

## Status: ✅ All fixes applied and verified (29/29 tests pass)

## Issues Fixed

### Blocking (all fixed)

| # | Issue | Fix |
|---|-------|-----|
| 1 | **Path normalization mismatch** — guard used `resolve()`, Pi uses `expandPath()` (@ strip, ~ expand, unicode normalize) | Rewrote `path-guard.ts` with `expandPath()` / `resolvePath()` matching Pi's `path-utils.ts` |
| 2 | **Symlink bypass** — no `realpath` canonicalization | Added `canonicalizePath()` using `realpathSync`, checks both lexical and canonical paths |
| 3 | **`allowWrite: []` allowed everything** — should deny all writes | Fixed: `undefined` = unrestricted, `[]` = deny all, `[...patterns]` = whitelist |
| 4 | **Subshells broken** — `(echo ok; rm -rf tmp)` only found `echo` | Rewrote: subshell segments `(...)` are now recursively parsed via `extractCommands()` |
| 5 | **`$(` double-incremented depth** — broke subsequent parsing | Fixed `splitCommandSegments`: `$(` now consumed as 2 chars with single depth increment |
| 6 | **`timeout 30 rm` extracted `30`** — prefix arg consumption broken | Rewrote prefix handling with per-command `PrefixSpec` (positionalArgs + flagsWithValue) |
| 7 | **`sudo -n rm` skipped `rm`** — wrapper flag heuristic too greedy | Rewrote wrapper handling with per-command `WrapperSpec` (known flag tables) |
| 8 | **Bash cwd tracking** — `cd dir && echo x > file` resolved against original cwd | Added `trackCwdChanges()` — tracks `cd` commands across segments, resolves targets against effective cwd |

### Important (all fixed)

| # | Issue | Fix |
|---|-------|-----|
| 9 | **Bash ignored `denyRead` + `allowWrite`** | Added `FILE_READ_COMMANDS` set + `matchesDenyRead()` for read detection; added `checkAllowWrite()` for bash write targets |
| 10 | **No config validation** — invalid types could crash at runtime | Added `validateConfig()` with per-field type checks; invalid fields logged and ignored |

### Minor (all fixed)

| # | Issue | Fix |
|---|-------|-----|
| 11 | **`/guardrails` display** — `allowWrite: []` showed `(unrestricted)` | Now shows `(deny all)` for empty array, `(unrestricted)` for undefined |
| 12 | **Redirection regex missed quoted paths** | Updated regex to handle `"path"` and `'path'` forms |

## Test Results

### Path normalization (3/3)
- ✅ `@.env` detected by denyRead
- ✅ `~/.ssh/id_rsa` detected by denyRead
- ✅ `.env` detected by denyRead

### allowWrite semantics (4/4)
- ✅ `allowWrite: []` denies all writes
- ✅ `allowWrite: undefined` allows all writes
- ✅ `allowWrite` with patterns allows matching
- ✅ `allowWrite` with patterns denies non-matching

### Symlink protection (3/3)
- ✅ `safe/creds → .env` detected by denyWrite
- ✅ `safe/creds → .env` detected by denyRead
- ✅ `@safe/creds → .env` detected

### Bash parser: prefix commands (3/3)
- ✅ `timeout 30 rm -rf tmp` → extracts `rm`
- ✅ `nice -n 5 rm -rf tmp` → extracts `rm`
- ✅ `timeout --signal=TERM 10 rm file` → extracts `rm`

### Bash parser: wrappers (3/3)
- ✅ `sudo -n rm tmp` → extracts `rm`
- ✅ `sudo -u root rm tmp` → extracts `rm`
- ✅ `bash -c 'rm file'` → extracts `rm`

### Bash parser: subshells (2/2)
- ✅ `(echo ok; rm -rf tmp)` → finds both
- ✅ `(cd /tmp && rm file)` → finds both

### Bash parser: command substitution (1/1)
- ✅ `echo $(id); rm -rf tmp` → finds `id` AND `rm`

### Bash cwd tracking (1/1)
- ✅ `cd secrets && echo x > config.json` → denyWrite violation detected

### Bash denyRead enforcement (2/2)
- ✅ `cat .env` → denyRead violation
- ✅ `head -n 5 ~/.ssh/config` → denyRead violation

### Bash allowWrite enforcement (1/1)
- ✅ `echo x > /outside/file` → blocked by `allowWrite: []`

### Original requirement (1/1)
- ✅ `cd / && rm .file` → `rm` detected as denied

### Config validation (5/5)
- ✅ Valid config loads correctly
- ✅ Invalid timeout ignored (falls back to default)
- ✅ String instead of array rejected
- ✅ Numeric values in array rejected
- ✅ No config file returns defaults
