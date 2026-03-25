/**
 * Guardrails Extension — Bash Command Guard
 *
 * Parses bash commands to extract individual commands and check them against
 * the deny list. Also detects file write operations and file read operations
 * within bash commands.
 *
 * Parsing approach:
 * 1. Normalize line continuations
 * 2. Split on command separators (&&, ||, ;, |, newlines) respecting quotes
 * 3. Recursively parse subshells (...) and command substitutions $(...)
 * 4. Recursively parse bash -c "...", sh -c "...", eval "..."
 * 5. Extract command name from each segment (skip env vars, prefixes)
 * 6. Track effective cwd across segments (cd DIR updates cwd)
 * 7. Detect file write operations (>, >>, cp, mv, tee, install, ln)
 * 8. Detect file read operations (cat, less, head, tail, etc.)
 *
 * Limitations (documented, best-effort):
 * - Cannot parse all possible bash syntax (heredocs, process substitution, etc.)
 * - Variable expansion is not resolved ($FILE, ${DIR}/path)
 * - Aliases and functions are not resolved
 * - Complex quoting edge cases may be missed
 * - cd tracking is best-effort (only handles literal cd arguments)
 */

import type { GuardrailsConfig, BashCheckResult, BashViolation, ExtractedCommand } from "./types.js";
import { matchesDenyWrite, matchesDenyRead, checkAllowWrite } from "./path-guard.js";
import { resolve } from "node:path";

// ─── Prefix command specifications ───

interface PrefixSpec {
  /** Flags that consume the next token as their value */
  flagsWithValue: Set<string>;
  /** Number of positional args before the wrapped command */
  positionalArgs: number;
}

/** Commands that prefix another command (like `time cmd`, `timeout 5 cmd`) */
const PREFIX_SPECS: Record<string, PrefixSpec> = {
  "time":     { flagsWithValue: new Set(["-f", "-o", "--format", "--output"]),       positionalArgs: 0 },
  "nice":     { flagsWithValue: new Set(["-n", "--adjustment"]),                     positionalArgs: 0 },
  "nohup":    { flagsWithValue: new Set(),                                           positionalArgs: 0 },
  "env":      { flagsWithValue: new Set(["-u", "--unset"]),                          positionalArgs: 0 },
  "timeout":  { flagsWithValue: new Set(["-s", "--signal", "-k", "--kill-after"]),   positionalArgs: 1 },
  "strace":   { flagsWithValue: new Set(["-e", "-o", "-p", "-s", "-S"]),             positionalArgs: 0 },
  "ltrace":   { flagsWithValue: new Set(["-e", "-o", "-p", "-s"]),                   positionalArgs: 0 },
  "ionice":   { flagsWithValue: new Set(["-c", "-n", "-p"]),                         positionalArgs: 0 },
  "taskset":  { flagsWithValue: new Set(["-c"]),                                     positionalArgs: 1 },
  "chrt":     { flagsWithValue: new Set(["-p"]),                                     positionalArgs: 1 },
  "runuser":  { flagsWithValue: new Set(["-u", "-g", "-G", "-l", "-c"]),             positionalArgs: 0 },
  "watch":    { flagsWithValue: new Set(["-n", "--interval", "-d"]),                 positionalArgs: 0 },
  "unbuffer": { flagsWithValue: new Set(),                                           positionalArgs: 0 },
  "setsid":   { flagsWithValue: new Set(),                                           positionalArgs: 0 },
};

// ─── Wrapper command specifications ───

interface WrapperSpec {
  type: "flag_c" | "next_arg" | "rest_args";
  /** Flags that consume the next token as their value (NOT the wrapped command) */
  flagsWithValue: Set<string>;
}

/** Commands that wrap another command (sudo, bash -c, exec, etc.) */
const WRAPPER_SPECS: Record<string, WrapperSpec> = {
  "bash":  { type: "flag_c",   flagsWithValue: new Set(["-O", "+O"]) },
  "sh":    { type: "flag_c",   flagsWithValue: new Set() },
  "zsh":   { type: "flag_c",   flagsWithValue: new Set(["-o"]) },
  "dash":  { type: "flag_c",   flagsWithValue: new Set() },
  "ksh":   { type: "flag_c",   flagsWithValue: new Set(["-o"]) },
  "fish":  { type: "flag_c",   flagsWithValue: new Set() },
  "eval":  { type: "rest_args", flagsWithValue: new Set() },
  "exec":  { type: "next_arg", flagsWithValue: new Set(["-a"]) },
  "xargs": { type: "next_arg", flagsWithValue: new Set(["-I", "-L", "-n", "-P", "-s", "-d", "--max-args", "--max-procs", "--delimiter"]) },
  "sudo":  { type: "next_arg", flagsWithValue: new Set(["-u", "--user", "-g", "--group", "-C", "--close-from", "-D", "--chdir", "-h", "--host", "-p", "--prompt", "-r", "--role", "-t", "--type", "-T", "--command-timeout"]) },
  "doas":  { type: "next_arg", flagsWithValue: new Set(["-u"]) },
  "su":    { type: "flag_c",   flagsWithValue: new Set(["-s", "--shell", "-g", "--group", "-G", "--supp-group"]) },
};

/** Commands that write to files (the last or specific arg is a destination) */
const FILE_WRITE_COMMANDS = new Set([
  "cp", "mv", "install", "ln", "rsync", "scp",
  "tee", "dd",
]);

/** Commands that read files (arguments are file paths) */
const FILE_READ_COMMANDS = new Set([
  "cat", "less", "more", "head", "tail", "nl", "wc", "grep", "egrep", "fgrep",
  "awk", "sed", "sort", "uniq", "cut", "paste", "tr", "strings", "xxd",
  "hexdump", "od", "file", "stat", "md5sum", "sha256sum", "shasum",
  "source", ".", "bat", "diff",
]);

// ─── Tokenizer ───

/**
 * Tokenize a command string into words, respecting quotes.
 */
function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    if (ch === "\\" && !inSingle) {
      current += ch + (s[i + 1] || "");
      i += 2;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Strip surrounding quotes from a token.
 */
function stripQuotes(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2) ||
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
  ) {
    return token.slice(1, -1);
  }
  return token;
}

// ─── Segment splitting ───

/**
 * Split a bash command string into segments by command separators,
 * respecting quoting and nesting.
 *
 * Subshell groups (...) are returned as a single segment with parens intact,
 * to be handled by the caller via recursive parsing.
 */
function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let parenDepth = 0;

  // Normalize line continuations
  const cmd = command.replace(/\\\n/g, " ");

  while (i < cmd.length) {
    const ch = cmd[i];
    const next = cmd[i + 1];

    // Handle escape outside single quotes
    if (ch === "\\" && !inSingleQuote) {
      current += ch + (next || "");
      i += 2;
      continue;
    }

    // Single quote toggling (not inside double quotes)
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }

    // Double quote toggling (not inside single quotes)
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      i++;
      continue;
    }

    // Inside quotes — consume as-is
    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      i++;
      continue;
    }

    // Handle $( — command substitution opening (count as ONE depth increment)
    if (ch === "$" && next === "(") {
      parenDepth++;
      current += "$(";
      i += 2;
      continue;
    }

    // Handle plain ( — subshell opening
    if (ch === "(") {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }

    // Handle )
    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    // Inside nested group — consume as-is
    if (parenDepth > 0) {
      current += ch;
      i++;
      continue;
    }

    // ─── Top-level command separators ───
    if (ch === ";" || ch === "\n") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i++;
      continue;
    }

    if (ch === "&" && next === "&") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 2;
      continue;
    }

    if (ch === "|" && next === "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i += 2;
      continue;
    }

    if (ch === "|" && next !== "|") {
      if (current.trim()) segments.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

// ─── Segment parsing ───

/**
 * Parse a single command segment into command name + arguments.
 * Skips env var assignments, prefix commands, and handles path-based commands.
 */
function parseSegment(segment: string): ExtractedCommand | null {
  let s = segment.trim();

  // Remove leading negation (!)
  if (s.startsWith("! ") || s === "!") {
    s = s.slice(1).trim();
  }

  const tokens = tokenize(s);
  if (tokens.length === 0) return null;

  let idx = 0;

  // Skip environment variable assignments (VAR=value)
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    idx++;
  }

  if (idx >= tokens.length) return null;

  // Skip prefix commands (time, nice, timeout, etc.) with proper arg consumption
  while (idx < tokens.length) {
    const spec = PREFIX_SPECS[stripQuotes(tokens[idx])];
    if (!spec) break;

    idx++; // skip prefix name

    // Skip flags (and their values)
    while (idx < tokens.length && tokens[idx].startsWith("-")) {
      const flag = tokens[idx];
      idx++;
      // Check if this flag consumes a value
      if (spec.flagsWithValue.has(flag) && idx < tokens.length) {
        idx++;
      } else if (flag.includes("=")) {
        // --flag=value form, already consumed
      }
    }

    // Skip positional args
    for (let p = 0; p < spec.positionalArgs && idx < tokens.length; p++) {
      // Don't consume something that looks like a command
      if (tokens[idx].startsWith("-")) break;
      idx++;
    }
  }

  if (idx >= tokens.length) return null;

  const name = stripQuotes(tokens[idx]);
  // Extract basename for path-based commands (e.g., /usr/bin/rm -> rm)
  const baseName = name.includes("/") ? name.split("/").pop()! : name;
  const args = tokens.slice(idx + 1).map(stripQuotes);

  return {
    name: baseName,
    fullSegment: segment,
    args,
  };
}

// ─── Command extraction ───

/**
 * Extract command substitution contents: $(...) and `...`
 */
function extractCommandSubstitutions(s: string): string[] {
  const results: string[] = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < s.length) {
    const ch = s[i];

    // Track quotes to avoid extracting inside string literals
    if (ch === "'" && !inDouble) { inSingle = !inSingle; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; i++; continue; }
    if (inSingle) { i++; continue; }

    // $(...) — handle nesting
    if (ch === "$" && s[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "$" && s[j + 1] === "(") { depth++; j += 2; continue; }
        if (s[j] === "(") { depth++; }
        if (s[j] === ")") { depth--; }
        if (depth > 0) j++;
      }
      if (depth === 0) {
        results.push(s.slice(i + 2, j));
        i = j + 1;
      } else {
        i = j;
      }
      continue;
    }

    // Backtick `...`
    if (ch === "`" && !inDouble) {
      let j = i + 1;
      while (j < s.length && s[j] !== "`") {
        if (s[j] === "\\") j++; // skip escaped
        j++;
      }
      if (j < s.length) {
        results.push(s.slice(i + 1, j));
        i = j + 1;
      } else {
        i = j;
      }
      continue;
    }

    i++;
  }

  return results;
}

/**
 * Recursively extract all commands from a bash command string.
 */
export function extractCommands(command: string): ExtractedCommand[] {
  const results: ExtractedCommand[] = [];
  const segments = splitCommandSegments(command);

  for (const segment of segments) {
    // ─── Handle subshells: (cmd1; cmd2) ───
    const trimmed = segment.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      const inner = trimmed.slice(1, -1);
      results.push(...extractCommands(inner));
      continue;
    }

    // ─── Extract command substitutions from this segment ───
    const substitutions = extractCommandSubstitutions(segment);
    for (const sub of substitutions) {
      results.push(...extractCommands(sub));
    }

    // ─── Parse the main command ───
    const parsed = parseSegment(segment);
    if (!parsed) continue;

    results.push(parsed);

    // ─── Handle wrapper commands ───
    const wrapper = WRAPPER_SPECS[parsed.name];
    if (wrapper) {
      let innerCommand: string | null = null;

      if (wrapper.type === "flag_c") {
        // bash -c "cmd", sh -c 'cmd'
        const flagIdx = parsed.args.indexOf("-c");
        if (flagIdx !== -1 && flagIdx + 1 < parsed.args.length) {
          innerCommand = parsed.args[flagIdx + 1];
        }
      } else if (wrapper.type === "rest_args") {
        // eval "cmd1; cmd2"
        innerCommand = parsed.args.join(" ");
      } else if (wrapper.type === "next_arg") {
        // sudo, exec, xargs — skip known flags, next is the command
        let argIdx = 0;
        while (argIdx < parsed.args.length) {
          const arg = parsed.args[argIdx];
          if (!arg.startsWith("-")) break;

          argIdx++;
          // Check if this flag consumes a value
          if (wrapper.flagsWithValue.has(arg) && argIdx < parsed.args.length) {
            argIdx++;
          } else if (arg.includes("=")) {
            // --flag=value, already consumed
          }
        }
        if (argIdx < parsed.args.length) {
          innerCommand = parsed.args.slice(argIdx).join(" ");
        }
      }

      if (innerCommand) {
        results.push(...extractCommands(innerCommand));
      }
    }
  }

  return results;
}

// ─── File operation detection ───

/**
 * Detect output redirections in a command segment and return target paths.
 */
function detectRedirections(segment: string): string[] {
  const paths: string[] = [];
  // Match: >, >>, 1>, 2>, &>, N> followed by a path (not &1, &2, etc.)
  // Handle quoted paths too
  const redirectRegex = /(?:\d+|&)?>>?\s*(?!&\d)(?:"([^"]+)"|'([^']+)'|([^\s;&|"']+))/g;
  let match: RegExpExecArray | null;
  while ((match = redirectRegex.exec(segment)) !== null) {
    const path = match[1] || match[2] || match[3];
    if (path && !path.startsWith("/dev/")) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Detect file write target paths from known file-writing commands.
 */
function detectFileWriteTargets(cmd: ExtractedCommand): string[] {
  const targets: string[] = [];

  if (cmd.name === "tee") {
    for (const arg of cmd.args) {
      if (!arg.startsWith("-")) {
        targets.push(arg);
      }
    }
  } else if (cmd.name === "dd") {
    for (const arg of cmd.args) {
      if (arg.startsWith("of=")) {
        targets.push(arg.slice(3));
      }
    }
  } else if (["cp", "mv", "install", "ln", "rsync", "scp"].includes(cmd.name)) {
    const nonFlagArgs = cmd.args.filter((a) => !a.startsWith("-"));
    if (nonFlagArgs.length >= 2) {
      targets.push(nonFlagArgs[nonFlagArgs.length - 1]);
    }
  }

  return targets;
}

/**
 * Detect file read target paths from known file-reading commands.
 */
function detectFileReadTargets(cmd: ExtractedCommand): string[] {
  const targets: string[] = [];

  for (const arg of cmd.args) {
    if (!arg.startsWith("-") && !arg.includes("=") && arg.length > 0) {
      targets.push(arg);
    }
  }

  return targets;
}

/**
 * Track effective cwd changes from cd commands in a sequence of segments.
 * Returns a map of segment index → effective cwd for that segment.
 */
function trackCwdChanges(segments: string[], baseCwd: string): string[] {
  const cwds: string[] = [];
  let currentCwd = baseCwd;

  for (const segment of segments) {
    cwds.push(currentCwd);

    // Check if this segment is a cd command
    const trimmed = segment.trim();
    const tokens = tokenize(trimmed);

    // Find the command (skip env vars)
    let idx = 0;
    while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
      idx++;
    }

    if (idx < tokens.length) {
      const cmd = stripQuotes(tokens[idx]);
      if (cmd === "cd" && idx + 1 < tokens.length) {
        const target = stripQuotes(tokens[idx + 1]);
        // Only handle simple literal cd targets
        if (target && !target.startsWith("$") && !target.includes("`")) {
          if (target === "-") {
            // cd - goes to previous dir, we can't track this
          } else if (target.startsWith("/")) {
            currentCwd = target;
          } else if (target === "~" || target.startsWith("~/")) {
            const homedir = process.env.HOME || "/";
            currentCwd = target === "~" ? homedir : resolve(homedir, target.slice(2));
          } else {
            currentCwd = resolve(currentCwd, target);
          }
        }
      }
    }
  }

  return cwds;
}

// ─── Main check ───

/**
 * Check a bash command against guardrails configuration.
 */
export function checkBash(command: string, cwd: string, config: GuardrailsConfig): BashCheckResult {
  const violations: BashViolation[] = [];
  const denyList = config.bash?.deny ?? [];
  const denySet = new Set(denyList.map((c) => c.toLowerCase()));

  const hasDenyRules = denySet.size > 0;
  const hasDenyWrite = (config.paths?.denyWrite?.length ?? 0) > 0;
  const hasAllowWrite = config.paths?.allowWrite !== undefined;
  const hasDenyRead = (config.paths?.denyRead?.length ?? 0) > 0;

  if (!hasDenyRules && !hasDenyWrite && !hasAllowWrite && !hasDenyRead) {
    return { allowed: true, violations: [] };
  }

  // Split at top level to track cwd changes
  const topSegments = splitCommandSegments(command);
  const segmentCwds = trackCwdChanges(topSegments, cwd);

  // Extract all commands (recursively)
  const allCommands = extractCommands(command);

  // For file-target checking, we need per-segment cwd.
  // Build a lookup: for each top segment, what's its effective cwd?
  // Then for each extracted command, find the best matching cwd.
  const segmentCwdMap = new Map<string, string>();
  for (let i = 0; i < topSegments.length; i++) {
    segmentCwdMap.set(topSegments[i], segmentCwds[i]);
  }

  for (const cmd of allCommands) {
    // Find the effective cwd for this command's segment
    const effectiveCwd = segmentCwdMap.get(cmd.fullSegment) ?? cwd;

    // ─── Check command name against deny list ───
    if (hasDenyRules && denySet.has(cmd.name.toLowerCase())) {
      violations.push({
        type: "denied_command",
        command: cmd.name,
        segment: cmd.fullSegment,
        details: `Command '${cmd.name}' is in the deny list`,
      });
    }

    // ─── Check file write operations against denyWrite + allowWrite ───
    if (hasDenyWrite || hasAllowWrite) {
      // Redirections
      const redirectTargets = detectRedirections(cmd.fullSegment);
      for (const target of redirectTargets) {
        checkWriteTarget(target, effectiveCwd, config, cmd, violations);
      }

      // File write commands
      if (FILE_WRITE_COMMANDS.has(cmd.name)) {
        const writeTargets = detectFileWriteTargets(cmd);
        for (const target of writeTargets) {
          checkWriteTarget(target, effectiveCwd, config, cmd, violations);
        }
      }
    }

    // ─── Check file read operations against denyRead ───
    if (hasDenyRead && FILE_READ_COMMANDS.has(cmd.name)) {
      const readTargets = detectFileReadTargets(cmd);
      for (const target of readTargets) {
        const matched = matchesDenyRead(target, effectiveCwd, config);
        if (matched) {
          violations.push({
            type: "file_read_detected",
            command: cmd.name,
            segment: cmd.fullSegment,
            details: `'${cmd.name}' reading '${target}' matches denyRead pattern: ${matched}`,
          });
        }
      }
    }
  }

  // Deduplicate violations (same command + same type + same details)
  const seen = new Set<string>();
  const unique: BashViolation[] = [];
  for (const v of violations) {
    const key = `${v.type}:${v.command}:${v.details}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(v);
    }
  }

  return {
    allowed: unique.length === 0,
    violations: unique,
  };
}

/**
 * Check a single write target against both denyWrite and allowWrite.
 */
function checkWriteTarget(
  target: string,
  effectiveCwd: string,
  config: GuardrailsConfig,
  cmd: ExtractedCommand,
  violations: BashViolation[],
): void {
  // Check denyWrite
  const denyMatch = matchesDenyWrite(target, effectiveCwd, config);
  if (denyMatch) {
    violations.push({
      type: "file_write_detected",
      command: cmd.name,
      segment: cmd.fullSegment,
      details: `Write to '${target}' matches denyWrite pattern: ${denyMatch}`,
    });
  }

  // Check allowWrite
  const allowBlock = checkAllowWrite(target, effectiveCwd, config);
  if (allowBlock) {
    violations.push({
      type: "file_write_detected",
      command: cmd.name,
      segment: cmd.fullSegment,
      details: `Write to '${target}': ${allowBlock}`,
    });
  }
}
