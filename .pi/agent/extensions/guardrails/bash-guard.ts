/**
 * Guardrails Extension — Bash Command Guard
 *
 * Checks bash commands against guardrails configuration using a hybrid approach:
 *
 * 1. AST-based analysis (via shfmt -tojson) — preferred
 *    - Accurate command extraction from proper shell parse tree
 *    - No false positives on quoted strings (echo "rm -rf" won't flag rm)
 *    - Handles control flow (if/for/while/case), functions, subshells
 *    - Correct redirect target extraction from AST nodes
 *
 * 2. String-based fallback — when shfmt is not available or parsing fails
 *    - Splits on command separators (&&, ||, ;, |, newlines)
 *    - Handles subshells, command substitution, wrapper commands
 *    - Best-effort but may produce false positives on quoted content
 *
 * Both paths apply the same guardrails checks:
 * - Command name deny list
 * - File write detection (redirections, cp, mv, tee, etc.)
 * - File read detection (cat, head, tail, grep, etc.)
 * - Wrapper/prefix command unwrapping (sudo, bash -c, eval, etc.)
 * - CWD tracking across cd commands
 */

import type { GuardrailsConfig, BashCheckResult, BashViolation, ExtractedCommand } from "./types.js";
import { matchesDenyWrite, matchesDenyRead, checkAllowWrite } from "./path-guard.js";
import { resolve } from "node:path";
import {
  parseShellAST,
  isShfmtAvailable,
  walkShellCommands,
  wordToString as astWordToString,
  type ASTCommand,
  type ShellFile,
} from "./shell-ast.js";

// ─── Shared constants ───

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

// ─── File operation detection (shared between AST and fallback) ───

/**
 * Detect file write target paths from known file-writing commands.
 */
function detectFileWriteTargets(name: string, args: string[]): string[] {
  const targets: string[] = [];

  if (name === "tee") {
    for (const arg of args) {
      if (!arg.startsWith("-")) {
        targets.push(arg);
      }
    }
  } else if (name === "dd") {
    for (const arg of args) {
      if (arg.startsWith("of=")) {
        targets.push(arg.slice(3));
      }
    }
  } else if (["cp", "mv", "install", "ln", "rsync", "scp"].includes(name)) {
    const nonFlagArgs = args.filter((a) => !a.startsWith("-"));
    if (nonFlagArgs.length >= 2) {
      targets.push(nonFlagArgs[nonFlagArgs.length - 1]);
    }
  }

  return targets;
}

/**
 * Detect file read target paths from known file-reading commands.
 */
function detectFileReadTargets(args: string[]): string[] {
  const targets: string[] = [];
  for (const arg of args) {
    if (!arg.startsWith("-") && !arg.includes("=") && arg.length > 0) {
      targets.push(arg);
    }
  }
  return targets;
}

/**
 * Check a single write target against both denyWrite and allowWrite.
 */
function checkWriteTarget(
  target: string,
  shellCwd: string,
  patternCwd: string,
  config: GuardrailsConfig,
  commandName: string,
  segment: string,
  violations: BashViolation[],
): void {
  const denyMatch = matchesDenyWrite(target, shellCwd, config, { patternCwd });
  if (denyMatch) {
    violations.push({
      type: "file_write_detected",
      command: commandName,
      segment,
      details: `Write to '${target}' matches denyWrite pattern: ${denyMatch}`,
    });
  }

  const allowBlock = checkAllowWrite(target, shellCwd, config, { patternCwd });
  if (allowBlock) {
    violations.push({
      type: "file_write_detected",
      command: commandName,
      segment,
      details: `Write to '${target}': ${allowBlock}`,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// AST-BASED ANALYSIS
// ═══════════════════════════════════════════════════════════════════

/**
 * Unwrap prefix commands in an AST-extracted argument list.
 * Returns the index of the actual command name.
 */
function unwrapPrefixes(args: string[]): number {
  let idx = 0;

  while (idx < args.length) {
    const spec = PREFIX_SPECS[args[idx]];
    if (!spec) break;

    idx++; // skip prefix name

    // Skip flags (and their values)
    while (idx < args.length && args[idx].startsWith("-")) {
      const flag = args[idx];
      idx++;
      if (spec.flagsWithValue.has(flag) && idx < args.length) {
        idx++;
      }
    }

    // Skip positional args
    for (let p = 0; p < spec.positionalArgs && idx < args.length; p++) {
      if (args[idx].startsWith("-")) break;
      idx++;
    }
  }

  return idx;
}

/**
 * Process a command from the AST, handling wrappers and prefix commands.
 * Returns all inner commands that should be checked.
 */
function processASTCommand(
  astCmd: ASTCommand,
  shellCwd: string,
  patternCwd: string,
  config: GuardrailsConfig,
  denySet: Set<string>,
  violations: BashViolation[],
  hasDenyRules: boolean,
  hasDenyWrite: boolean,
  hasAllowWrite: boolean,
  hasDenyRead: boolean,
): void {
  // Full args including command name for prefix unwrapping
  const allArgs = [astCmd.name, ...astCmd.args];
  const realIdx = unwrapPrefixes(allArgs);

  if (realIdx >= allArgs.length) return;

  const cmdName = allArgs[realIdx];
  const cmdArgs = allArgs.slice(realIdx + 1);
  const segment = `${cmdName} ${cmdArgs.join(" ")}`.trim();

  // ─── Check command name against deny list ───
  if (hasDenyRules && denySet.has(cmdName.toLowerCase())) {
    violations.push({
      type: "denied_command",
      command: cmdName,
      segment,
      details: `Command '${cmdName}' is in the deny list`,
    });
  }

  // ─── Check write redirections (from AST) ───
  if (hasDenyWrite || hasAllowWrite) {
    for (const target of astCmd.writeRedirects) {
      checkWriteTarget(target, shellCwd, patternCwd, config, cmdName, segment, violations);
    }

    // Check file write commands
    if (FILE_WRITE_COMMANDS.has(cmdName)) {
      const writeTargets = detectFileWriteTargets(cmdName, cmdArgs);
      for (const target of writeTargets) {
        checkWriteTarget(target, shellCwd, patternCwd, config, cmdName, segment, violations);
      }
    }
  }

  // ─── Check file read operations ───
  if (hasDenyRead && FILE_READ_COMMANDS.has(cmdName)) {
    const readTargets = detectFileReadTargets(cmdArgs);
    for (const target of readTargets) {
      const matched = matchesDenyRead(target, shellCwd, config, { patternCwd });
      if (matched) {
        violations.push({
          type: "file_read_detected",
          command: cmdName,
          segment,
          details: `'${cmdName}' reading '${target}' matches denyRead pattern: ${matched}`,
        });
      }
    }
  }

  // ─── Handle wrapper commands — recursively parse inner command strings ───
  const wrapper = WRAPPER_SPECS[cmdName];
  if (wrapper) {
    let innerCommand: string | null = null;

    if (wrapper.type === "flag_c") {
      const flagIdx = cmdArgs.indexOf("-c");
      if (flagIdx !== -1 && flagIdx + 1 < cmdArgs.length) {
        innerCommand = cmdArgs[flagIdx + 1];
      }
    } else if (wrapper.type === "rest_args") {
      innerCommand = cmdArgs.join(" ");
    } else if (wrapper.type === "next_arg") {
      let argIdx = 0;
      while (argIdx < cmdArgs.length) {
        const arg = cmdArgs[argIdx];
        if (!arg.startsWith("-")) break;
        argIdx++;
        if (wrapper.flagsWithValue.has(arg) && argIdx < cmdArgs.length) {
          argIdx++;
        }
      }
      if (argIdx < cmdArgs.length) {
        innerCommand = cmdArgs.slice(argIdx).join(" ");
      }
    }

    if (innerCommand) {
      // Try AST parsing the inner command too
      const innerViolations = checkBashInner(
        innerCommand,
        shellCwd,
        patternCwd,
        config,
        denySet,
        hasDenyRules,
        hasDenyWrite,
        hasAllowWrite,
        hasDenyRead,
      );
      violations.push(...innerViolations);
    }
  }
}

/**
 * Inner check function used by both top-level and recursive wrapper parsing.
 */
function checkBashInner(
  command: string,
  cwd: string,
  patternCwd: string,
  config: GuardrailsConfig,
  denySet: Set<string>,
  hasDenyRules: boolean,
  hasDenyWrite: boolean,
  hasAllowWrite: boolean,
  hasDenyRead: boolean,
): BashViolation[] {
  const violations: BashViolation[] = [];

  // Try AST parsing
  const ast = parseShellAST(command);
  if (ast) {
    checkBashViaAST(ast, cwd, patternCwd, config, denySet, violations, hasDenyRules, hasDenyWrite, hasAllowWrite, hasDenyRead);
  } else {
    // Fallback to string-based parsing
    checkBashViaFallback(command, cwd, patternCwd, config, denySet, violations, hasDenyRules, hasDenyWrite, hasAllowWrite, hasDenyRead);
  }

  return violations;
}

/**
 * AST-based bash analysis.
 */
function checkBashViaAST(
  ast: ShellFile,
  cwd: string,
  patternCwd: string,
  config: GuardrailsConfig,
  denySet: Set<string>,
  violations: BashViolation[],
  hasDenyRules: boolean,
  hasDenyWrite: boolean,
  hasAllowWrite: boolean,
  hasDenyRead: boolean,
): void {
  let shellCwd = cwd;

  walkShellCommands(ast, (astCmd) => {
    // Track cwd changes
    if (astCmd.name === "cd" && astCmd.args.length > 0) {
      const target = astCmd.args[0];
      if (target && !target.startsWith("$") && !target.includes("$(__cmd_subst__)")) {
        if (target === "-") {
          // cd - goes to previous dir, we can't track this
        } else if (target.startsWith("/")) {
          shellCwd = target;
        } else if (target === "~" || target.startsWith("~/")) {
          const homedir = process.env.HOME || "/";
          shellCwd = target === "~" ? homedir : resolve(homedir, target.slice(2));
        } else {
          shellCwd = resolve(shellCwd, target);
        }
      }
    }

    processASTCommand(
      astCmd,
      shellCwd,
      patternCwd,
      config,
      denySet,
      violations,
      hasDenyRules,
      hasDenyWrite,
      hasAllowWrite,
      hasDenyRead,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════
// STRING-BASED FALLBACK (existing implementation, kept intact)
// ═══════════════════════════════════════════════════════════════════

// ─── Tokenizer ───

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

function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let parenDepth = 0;

  const cmd = command.replace(/\\\n/g, " ");

  while (i < cmd.length) {
    const ch = cmd[i];
    const next = cmd[i + 1];

    if (ch === "\\" && !inSingleQuote) {
      current += ch + (next || "");
      i += 2;
      continue;
    }

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      i++;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += ch;
      i++;
      continue;
    }

    if (ch === "$" && next === "(") {
      parenDepth++;
      current += "$(";
      i += 2;
      continue;
    }

    if (ch === "(") {
      parenDepth++;
      current += ch;
      i++;
      continue;
    }

    if (ch === ")" && parenDepth > 0) {
      parenDepth--;
      current += ch;
      i++;
      continue;
    }

    if (parenDepth > 0) {
      current += ch;
      i++;
      continue;
    }

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

function parseSegment(segment: string): ExtractedCommand | null {
  let s = segment.trim();

  if (s.startsWith("! ") || s === "!") {
    s = s.slice(1).trim();
  }

  const tokens = tokenize(s);
  if (tokens.length === 0) return null;

  let idx = 0;

  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
    idx++;
  }

  if (idx >= tokens.length) return null;

  while (idx < tokens.length) {
    const spec = PREFIX_SPECS[stripQuotes(tokens[idx])];
    if (!spec) break;

    idx++;

    while (idx < tokens.length && tokens[idx].startsWith("-")) {
      const flag = tokens[idx];
      idx++;
      if (spec.flagsWithValue.has(flag) && idx < tokens.length) {
        idx++;
      } else if (flag.includes("=")) {
        // --flag=value form
      }
    }

    for (let p = 0; p < spec.positionalArgs && idx < tokens.length; p++) {
      if (tokens[idx].startsWith("-")) break;
      idx++;
    }
  }

  if (idx >= tokens.length) return null;

  const name = stripQuotes(tokens[idx]);
  const baseName = name.includes("/") ? name.split("/").pop()! : name;
  const args = tokens.slice(idx + 1).map(stripQuotes);

  return {
    name: baseName,
    fullSegment: segment,
    args,
  };
}

// ─── Command extraction (fallback) ───

function extractCommandSubstitutions(s: string): string[] {
  const results: string[] = [];
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < s.length) {
    const ch = s[i];

    if (ch === "'" && !inDouble) { inSingle = !inSingle; i++; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; i++; continue; }
    if (inSingle) { i++; continue; }

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

    if (ch === "`" && !inDouble) {
      let j = i + 1;
      while (j < s.length && s[j] !== "`") {
        if (s[j] === "\\") j++;
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

function extractCommandsFallback(command: string): ExtractedCommand[] {
  const results: ExtractedCommand[] = [];
  const segments = splitCommandSegments(command);

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
      const inner = trimmed.slice(1, -1);
      results.push(...extractCommandsFallback(inner));
      continue;
    }

    const substitutions = extractCommandSubstitutions(segment);
    for (const sub of substitutions) {
      results.push(...extractCommandsFallback(sub));
    }

    const parsed = parseSegment(segment);
    if (!parsed) continue;

    results.push(parsed);

    const wrapper = WRAPPER_SPECS[parsed.name];
    if (wrapper) {
      let innerCommand: string | null = null;

      if (wrapper.type === "flag_c") {
        const flagIdx = parsed.args.indexOf("-c");
        if (flagIdx !== -1 && flagIdx + 1 < parsed.args.length) {
          innerCommand = parsed.args[flagIdx + 1];
        }
      } else if (wrapper.type === "rest_args") {
        innerCommand = parsed.args.join(" ");
      } else if (wrapper.type === "next_arg") {
        let argIdx = 0;
        while (argIdx < parsed.args.length) {
          const arg = parsed.args[argIdx];
          if (!arg.startsWith("-")) break;
          argIdx++;
          if (wrapper.flagsWithValue.has(arg) && argIdx < parsed.args.length) {
            argIdx++;
          }
        }
        if (argIdx < parsed.args.length) {
          innerCommand = parsed.args.slice(argIdx).join(" ");
        }
      }

      if (innerCommand) {
        results.push(...extractCommandsFallback(innerCommand));
      }
    }
  }

  return results;
}

// ─── Redirection detection (fallback) ───

function detectRedirections(segment: string): string[] {
  const paths: string[] = [];
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

// ─── Fallback cwd tracking ───

function trackCwdChanges(segments: string[], baseCwd: string): string[] {
  const cwds: string[] = [];
  let currentCwd = baseCwd;

  for (const segment of segments) {
    cwds.push(currentCwd);

    const trimmed = segment.trim();
    const tokens = tokenize(trimmed);

    let idx = 0;
    while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) {
      idx++;
    }

    if (idx < tokens.length) {
      const cmd = stripQuotes(tokens[idx]);
      if (cmd === "cd" && idx + 1 < tokens.length) {
        const target = stripQuotes(tokens[idx + 1]);
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

/**
 * Fallback string-based bash analysis.
 */
function checkBashViaFallback(
  command: string,
  cwd: string,
  patternCwd: string,
  config: GuardrailsConfig,
  denySet: Set<string>,
  violations: BashViolation[],
  hasDenyRules: boolean,
  hasDenyWrite: boolean,
  hasAllowWrite: boolean,
  hasDenyRead: boolean,
): void {
  const topSegments = splitCommandSegments(command);
  const segmentCwds = trackCwdChanges(topSegments, cwd);

  const allCommands = extractCommandsFallback(command);

  const segmentCwdMap = new Map<string, string>();
  for (let i = 0; i < topSegments.length; i++) {
    segmentCwdMap.set(topSegments[i], segmentCwds[i]);
  }

  for (const cmd of allCommands) {
    const shellCwd = segmentCwdMap.get(cmd.fullSegment) ?? cwd;

    if (hasDenyRules && denySet.has(cmd.name.toLowerCase())) {
      violations.push({
        type: "denied_command",
        command: cmd.name,
        segment: cmd.fullSegment,
        details: `Command '${cmd.name}' is in the deny list`,
      });
    }

    if (hasDenyWrite || hasAllowWrite) {
      const redirectTargets = detectRedirections(cmd.fullSegment);
      for (const target of redirectTargets) {
        checkWriteTarget(target, shellCwd, patternCwd, config, cmd.name, cmd.fullSegment, violations);
      }

      if (FILE_WRITE_COMMANDS.has(cmd.name)) {
        const writeTargets = detectFileWriteTargets(cmd.name, cmd.args);
        for (const target of writeTargets) {
          checkWriteTarget(target, shellCwd, patternCwd, config, cmd.name, cmd.fullSegment, violations);
        }
      }
    }

    if (hasDenyRead && FILE_READ_COMMANDS.has(cmd.name)) {
      const readTargets = detectFileReadTargets(cmd.args);
      for (const target of readTargets) {
        const matched = matchesDenyRead(target, shellCwd, config, { patternCwd });
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
}

// ═══════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════

/**
 * Check a bash command against guardrails configuration.
 * Uses AST parsing when shfmt is available, falls back to string parsing.
 */
export function checkBash(
  command: string,
  cwd: string,
  config: GuardrailsConfig,
  options: { patternCwd?: string } = {},
): BashCheckResult {
  const violations: BashViolation[] = [];
  const patternCwd = options.patternCwd ?? cwd;
  const denyList = config.bash?.deny ?? [];
  const denySet = new Set(denyList.map((c) => c.toLowerCase()));

  const hasDenyRules = denySet.size > 0;
  const hasDenyWrite = (config.paths?.denyWrite?.length ?? 0) > 0;
  const hasAllowWrite = config.paths?.allowWrite !== undefined;
  const hasDenyRead = (config.paths?.denyRead?.length ?? 0) > 0;

  if (!hasDenyRules && !hasDenyWrite && !hasAllowWrite && !hasDenyRead) {
    return { allowed: true, violations: [] };
  }

  // Try AST-based analysis first
  const ast = parseShellAST(command);
  if (ast) {
    checkBashViaAST(ast, cwd, patternCwd, config, denySet, violations, hasDenyRules, hasDenyWrite, hasAllowWrite, hasDenyRead);
  } else {
    // Fallback to string-based analysis
    checkBashViaFallback(command, cwd, patternCwd, config, denySet, violations, hasDenyRules, hasDenyWrite, hasAllowWrite, hasDenyRead);
  }

  // Deduplicate violations
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
 * Check if AST-based parsing is available.
 * Exposed for status display.
 */
export { isShfmtAvailable };
