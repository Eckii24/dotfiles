import type { GuardrailsConfig } from "./types.js";
import { parseShellAST, walkShellCommands, wordToString, type ShellFile } from "./shell-ast.js";

export interface CommandGateResult {
  gate: 1 | 2;
  decision: "allow" | "preflight";
  requiresPreflight: boolean;
  reason: string;
  hints: string[];
}

const DEFAULT_GATE1_ALLOW = new Set([
  "pwd",
  "which",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "nl",
  "grep",
  "egrep",
  "fgrep",
  "sort",
  "uniq",
  "cut",
  "paste",
  "tr",
  "strings",
  "xxd",
  "hexdump",
  "od",
  "file",
  "stat",
  "md5sum",
  "sha256sum",
  "shasum",
  "diff",
]);

const NETWORK_COMMANDS = new Set(["curl", "wget", "nc", "ncat", "ssh", "scp"]);
const WRITE_COMMANDS = new Set(["cp", "mv", "install", "ln", "rsync", "scp", "tee", "dd"]);
const PROCESS_CONTROL_COMMANDS = new Set(["kill", "killall", "pkill", "nohup", "setsid"]);
const WRAPPER_COMMANDS = new Set(["bash", "sh", "zsh", "fish", "eval", "xargs", "sudo", "env", "time", "timeout"]);

function hasPlaceholderToken(value: string): boolean {
  return /\$\{?[A-Za-z_]/.test(value) || value.includes("$(__cmd_subst__)") || value.includes("$((…))") || value.includes("<(…)") || value.includes("`");
}

function getConfiguredAllow(config: GuardrailsConfig): Set<string> {
  const configured = config.bash?.allow ?? [];
  return new Set([...DEFAULT_GATE1_ALLOW, ...configured].map((v) => v.toLowerCase()));
}

function isReadOnlyGitCommand(args: string[]): boolean {
  const subcommand = args[0]?.toLowerCase();
  return subcommand !== undefined && ["status", "diff", "log", "show"].includes(subcommand);
}

function tokenizeSimpleCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "\\" && !inSingle) {
      current += next ?? "";
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (inSingle || inDouble) return null;
  if (current) tokens.push(current);
  return tokens;
}

function hasUnsafeShellSyntaxOutsideQuotes(command: string): boolean {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "\\" && !inSingle) {
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && (ch === "`" || (ch === "$" && next === "("))) return true;

    if (!inSingle && !inDouble) {
      if (ch === "\n" || ch === ";" || ch === "|" || ch === "&" || ch === "<" || ch === ">") return true;
      if (ch === "(" || ch === ")") return true;
    }
  }

  return inSingle || inDouble;
}

function isSimpleAllowlistedFallback(command: string, config: GuardrailsConfig): boolean {
  if (hasUnsafeShellSyntaxOutsideQuotes(command)) return false;

  const tokens = tokenizeSimpleCommand(command.trim());
  if (!tokens || tokens.length === 0) return false;

  const commandName = tokens[0];
  if (!commandName || commandName.includes("/") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(commandName)) return false;
  if (tokens.some(hasPlaceholderToken)) return false;

  const args = tokens.slice(1);
  const allowSet = getConfiguredAllow(config);
  const lowerName = commandName.toLowerCase();
  if (allowSet.has(lowerName)) return true;
  if (lowerName === "git") return isReadOnlyGitCommand(args);
  return false;
}

function isSimpleAllowlistedAST(ast: ShellFile, config: GuardrailsConfig): boolean {
  if (ast.Stmts.length !== 1) return false;

  const stmt = ast.Stmts[0];
  if (!stmt?.Cmd || stmt.Cmd.Type !== "CallExpr" || stmt.Background) return false;
  if (stmt.Redirs && stmt.Redirs.length > 0) return false;
  if (!stmt.Cmd.Args || stmt.Cmd.Args.length === 0) return false;

  const commandName = wordToString(stmt.Cmd.Args[0]);
  if (!commandName || commandName.includes("/")) return false;

  const args = stmt.Cmd.Args.slice(1).map(wordToString);
  if ([commandName, ...args].some(hasPlaceholderToken)) return false;

  let commandCount = 0;
  let onlySimple = true;
  let hasWriteRedirect = false;
  walkShellCommands(ast, (cmd) => {
    commandCount += 1;
    if (cmd.writeRedirects.length > 0) hasWriteRedirect = true;
    if (cmd.name !== commandName) onlySimple = false;
    if ([cmd.name, ...cmd.args].some(hasPlaceholderToken)) onlySimple = false;
  });

  if (commandCount !== 1 || !onlySimple || hasWriteRedirect) return false;

  const allowSet = getConfiguredAllow(config);
  const lowerName = commandName.toLowerCase();
  if (allowSet.has(lowerName)) return true;
  if (lowerName === "git") return isReadOnlyGitCommand(args);
  return false;
}

function collectPreflightHints(command: string, ast: ShellFile | null): string[] {
  const hints: string[] = [];
  const lower = command.toLowerCase();

  if (ast) {
    if (ast.Stmts.length > 1) hints.push("multiple commands");

    walkShellCommands(ast, (cmd) => {
      const lowerName = cmd.name.toLowerCase();
      if (cmd.writeRedirects.length > 0) hints.push("write redirection");
      if (NETWORK_COMMANDS.has(lowerName)) hints.push("network access");
      if (WRITE_COMMANDS.has(lowerName)) hints.push("file mutation");
      if (PROCESS_CONTROL_COMMANDS.has(lowerName)) hints.push("process control");
      if (WRAPPER_COMMANDS.has(lowerName)) hints.push("wrapper or indirect shell execution");
      if ((lowerName === "git" && !isReadOnlyGitCommand(cmd.args)) || (lowerName === "sed" && cmd.args.includes("-i"))) {
        hints.push("repo or file mutation");
      }
      if ([cmd.name, ...cmd.args].some(hasPlaceholderToken)) hints.push("command substitution or process substitution");
    });
  }

  if (/&&|\|\||;|\n/.test(command)) hints.push("multiple commands");
  if (/(^|[^|])\|([^|]|$)/.test(command)) hints.push("pipe execution");
  if (/>>?|&>>?/.test(command)) hints.push("write redirection");
  if (/\$\(|`/.test(command) || /<\(|>\(/.test(command)) hints.push("command substitution or process substitution");
  if (/\b(curl|wget|nc|ncat|ssh|scp)\b/.test(lower)) hints.push("network access");
  if (/\b(cp|mv|install|ln|rsync|tee|dd)\b/.test(lower)) hints.push("file mutation");
  if (/\b(kill|killall|pkill|nohup|setsid)\b/.test(lower)) hints.push("process control");
  if (/\b(bash|sh|zsh|fish|eval|xargs|sudo)\b/.test(lower) && /\s-c\b|\beval\b|\bxargs\b|\bsudo\b/.test(lower)) {
    hints.push("wrapper or indirect shell execution");
  }

  return [...new Set(hints)];
}

export function evaluateBashCommandGates(
  command: string,
  _cwd: string,
  config: GuardrailsConfig,
  options: { forceFallback?: boolean } = {},
): CommandGateResult {
  const ast = options.forceFallback ? null : parseShellAST(command);

  if (ast ? isSimpleAllowlistedAST(ast, config) : isSimpleAllowlistedFallback(command, config)) {
    return {
      gate: 1,
      decision: "allow",
      requiresPreflight: false,
      reason: "Gate 1 allowlist: simple AST-verified command",
      hints: [],
    };
  }

  const hints = collectPreflightHints(command, ast);
  return {
    gate: 2,
    decision: "preflight",
    requiresPreflight: true,
    reason: hints.length > 0
      ? `Gate 2 preflight required: ${hints.join(", ")}`
      : "Gate 2 preflight required: command is outside the Gate-1 allowlist",
    hints,
  };
}
