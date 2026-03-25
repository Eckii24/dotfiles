/**
 * Guardrails Extension — Shell AST Parser (via shfmt)
 *
 * Uses `shfmt -tojson` to parse bash commands into an AST for accurate
 * command extraction. Falls back gracefully when shfmt is not available.
 *
 * shfmt is a widely available shell formatter/parser. When installed, it
 * provides `-tojson` which outputs a JSON AST based on mvdan.cc/sh/v3/syntax.
 *
 * Benefits over string-based parsing:
 * - No false positives on quoted strings (e.g., echo "rm -rf" won't flag rm)
 * - Proper handling of control flow (if/for/while/case)
 * - Correct redirect target extraction
 * - Handles function declarations, subshells, command substitution
 *
 * When shfmt is not available, the bash-guard falls back to the existing
 * string-based parser with no loss of current functionality.
 */

import { execFileSync } from "node:child_process";

// ─── shfmt AST Types ───

/** Position in source */
export interface Pos {
  Offset: number;
  Line: number;
  Col: number;
}

/** A word composed of parts */
export interface Word {
  Pos: Pos;
  End: Pos;
  Parts: WordPart[];
}

/** Literal text */
export interface Lit {
  Type: "Lit";
  Value: string;
}

/** Single-quoted string */
export interface SglQuoted {
  Type: "SglQuoted";
  Value: string;
}

/** Double-quoted string (may contain expansions) */
export interface DblQuoted {
  Type: "DblQuoted";
  Parts: WordPart[];
}

/** Parameter expansion ($VAR, ${VAR}, etc.) */
export interface ParamExp {
  Type: "ParamExp";
  Param: { Value: string };
  Short?: boolean;
}

/** Command substitution $(...) */
export interface CmdSubst {
  Type: "CmdSubst";
  Stmts: Stmt[];
}

/** Arithmetic expansion $((...)) */
export interface ArithExp {
  Type: "ArithExp";
}

/** Process substitution <(...) or >(...) */
export interface ProcSubst {
  Type: "ProcSubst";
  Op: number;
  Stmts: Stmt[];
}

export type WordPart = Lit | SglQuoted | DblQuoted | ParamExp | CmdSubst | ArithExp | ProcSubst;

/** Variable assignment (FOO=bar) */
export interface Assign {
  Name: { Value: string };
  Value?: Word;
}

/** Redirection (>, >>, <, etc.) */
export interface Redirect {
  Op: number;
  Word: Word;
  N?: { Value: string };
}

/** Simple command call (e.g., echo hello) */
export interface CallExpr {
  Type: "CallExpr";
  Args: Word[];
  Assigns?: Assign[];
}

/** Binary command (&&, ||, |, |&) */
export interface BinaryCmd {
  Type: "BinaryCmd";
  Op: number;
  X: Stmt;
  Y: Stmt;
}

/** Subshell (...) */
export interface Subshell {
  Type: "Subshell";
  Stmts: Stmt[];
}

/** Block { ...; } */
export interface Block {
  Type: "Block";
  Stmts: Stmt[];
}

/** If clause */
export interface IfClause {
  Type: "IfClause";
  Cond: Stmt[];
  Then: Stmt[];
  Else?: Stmt[] | IfClause;
}

/** For clause */
export interface ForClause {
  Type: "ForClause";
  Loop: unknown;
  Do: Stmt[];
}

/** While/Until clause */
export interface WhileClause {
  Type: "WhileClause";
  Cond: Stmt[];
  Do: Stmt[];
}

/** Case clause */
export interface CaseClause {
  Type: "CaseClause";
  Word: Word;
  Items: CaseItem[];
}

export interface CaseItem {
  Patterns: Word[];
  Stmts: Stmt[];
}

/** Function declaration */
export interface FuncDecl {
  Type: "FuncDecl";
  Name: { Value: string };
  Body: Stmt;
}

/** Declare/local/export etc. */
export interface DeclClause {
  Type: "DeclClause";
  Args: Word[];
  Assigns?: Assign[];
}

/** Let clause */
export interface LetClause {
  Type: "LetClause";
}

/** Test clause [[ ... ]] */
export interface TestClause {
  Type: "TestClause";
}

/** Arithmetic command (( ... )) */
export interface ArithCmd {
  Type: "ArithCmd";
}

/** Time clause */
export interface TimeClause {
  Type: "TimeClause";
  Stmt: Stmt;
}

/** Coproc clause */
export interface CoprocClause {
  Type: "CoprocClause";
  Body: Stmt;
}

export type Command =
  | CallExpr
  | BinaryCmd
  | Subshell
  | Block
  | IfClause
  | ForClause
  | WhileClause
  | CaseClause
  | FuncDecl
  | DeclClause
  | LetClause
  | TestClause
  | ArithCmd
  | TimeClause
  | CoprocClause;

/** A single statement (command + optional redirects) */
export interface Stmt {
  Cmd: Command;
  Redirs?: Redirect[];
}

/** Top-level file node */
export interface ShellFile {
  Type: "File";
  Stmts: Stmt[];
}

// ─── Redirect Op constants (shfmt v3) ───

export const REDIR_OUT = 54;      // >
export const REDIR_APPEND = 55;   // >>
export const REDIR_IN = 56;       // <
export const REDIR_INOUT = 57;    // <>
export const REDIR_DPLOUT = 59;   // >&  (e.g. 2>&1)
export const REDIR_HDOC = 61;     // <<
export const REDIR_DASHHDOC = 62; // <<-
export const REDIR_HERESTR = 63;  // <<<
export const REDIR_ALL = 64;      // &>
export const REDIR_APPALL = 65;   // &>>

/** Redirect ops that write to files (not fd duplication or heredocs) */
export const WRITE_REDIRECT_OPS = new Set([
  REDIR_OUT,     // >
  REDIR_APPEND,  // >>
  REDIR_INOUT,   // <>
  REDIR_ALL,     // &>
  REDIR_APPALL,  // &>>
]);

// ─── Binary Op constants ───

export const OP_AND = 10;   // &&
export const OP_OR = 11;    // ||
export const OP_PIPE = 12;  // |
export const OP_PIPEALL = 13; // |&

// ─── shfmt availability detection ───

let shfmtPath: string | null | undefined = undefined; // undefined = not checked yet

/**
 * Find shfmt binary. Checks common locations and PATH.
 * Caches result for the process lifetime.
 */
export function findShfmt(): string | null {
  if (shfmtPath !== undefined) return shfmtPath;

  // Try executing shfmt to check availability
  try {
    execFileSync("shfmt", ["--version"], {
      timeout: 2000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    shfmtPath = "shfmt";
    return shfmtPath;
  } catch {
    // Not in PATH
  }

  // Try common locations
  const locations = [
    "/usr/local/bin/shfmt",
    "/usr/bin/shfmt",
    "/opt/homebrew/bin/shfmt",
  ];

  // Also check mason (neovim) path
  const home = process.env.HOME;
  if (home) {
    locations.push(`${home}/.local/share/nvim/mason/bin/shfmt`);
    locations.push(`${home}/.local/bin/shfmt`);
    locations.push(`${home}/go/bin/shfmt`);
  }

  for (const loc of locations) {
    try {
      execFileSync(loc, ["--version"], {
        timeout: 2000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      shfmtPath = loc;
      return shfmtPath;
    } catch {
      // Not found at this location
    }
  }

  shfmtPath = null;
  return null;
}

/**
 * Check if shfmt is available. Same as findShfmt() !== null.
 */
export function isShfmtAvailable(): boolean {
  return findShfmt() !== null;
}

// ─── AST Parsing ───

/**
 * Parse a bash command string into a shell AST via shfmt.
 * Returns null if shfmt is not available or parsing fails.
 */
export function parseShellAST(command: string): ShellFile | null {
  const binary = findShfmt();
  if (!binary) return null;

  try {
    const stdout = execFileSync(binary, ["-tojson"], {
      input: command,
      timeout: 5000,
      maxBuffer: 1024 * 1024, // 1MB should be plenty
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf-8",
    });

    return JSON.parse(stdout) as ShellFile;
  } catch {
    // Parse failure (invalid bash syntax, timeout, etc.)
    return null;
  }
}

// ─── AST Walking ───

/**
 * Resolve a Word node to its literal string value.
 * Concatenates Lit, SglQuoted, and simple DblQuoted parts.
 * For parameter expansions, includes $VAR representation.
 * For command substitutions, includes $(...) placeholder.
 */
export function wordToString(word: Word): string {
  return word.Parts.map(partToString).join("");
}

function partToString(part: WordPart): string {
  switch (part.Type) {
    case "Lit":
      return part.Value;
    case "SglQuoted":
      return part.Value;
    case "DblQuoted":
      return part.Parts.map(partToString).join("");
    case "ParamExp":
      return part.Short ? `$${part.Param.Value}` : `\${${part.Param.Value}}`;
    case "CmdSubst":
      return "$(__cmd_subst__)";
    case "ArithExp":
      return "$((…))";
    case "ProcSubst":
      return "<(…)";
    default:
      return "";
  }
}

/** Information about a command extracted from the AST */
export interface ASTCommand {
  /** The command name (first word, basename if path) */
  name: string;
  /** All argument words as strings */
  args: string[];
  /** Redirect targets that write to files */
  writeRedirects: string[];
  /** The statement this command came from (for context) */
  stmt: Stmt;
}

/**
 * Walk all statements in a ShellFile, calling the callback for each
 * CallExpr (simple command) found at any nesting depth.
 *
 * Also walks into command substitutions found in word parts.
 */
export function walkShellCommands(
  ast: ShellFile,
  callback: (cmd: ASTCommand) => void,
): void {
  for (const stmt of ast.Stmts) {
    walkStmt(stmt, callback);
  }
}

function walkStmt(stmt: Stmt, callback: (cmd: ASTCommand) => void): void {
  walkCommand(stmt.Cmd, stmt, callback);

  // Also walk into command substitutions in redirect targets
  if (stmt.Redirs) {
    for (const redir of stmt.Redirs) {
      walkWordParts(redir.Word, callback);
    }
  }
}

function walkStmts(stmts: Stmt[], callback: (cmd: ASTCommand) => void): void {
  for (const stmt of stmts) {
    walkStmt(stmt, callback);
  }
}

function walkCommand(
  cmd: Command,
  parentStmt: Stmt,
  callback: (cmd: ASTCommand) => void,
): void {
  if (!cmd) return;

  switch (cmd.Type) {
    case "CallExpr": {
      if (cmd.Args && cmd.Args.length > 0) {
        const name = wordToString(cmd.Args[0]);
        const baseName = name.includes("/") ? name.split("/").pop()! : name;
        const args = cmd.Args.slice(1).map(wordToString);

        // Collect write redirect targets from the parent statement
        const writeRedirects: string[] = [];
        if (parentStmt.Redirs) {
          for (const redir of parentStmt.Redirs) {
            if (WRITE_REDIRECT_OPS.has(redir.Op)) {
              const target = wordToString(redir.Word);
              if (target && !target.startsWith("/dev/")) {
                writeRedirects.push(target);
              }
            }
          }
        }

        callback({ name: baseName, args, writeRedirects, stmt: parentStmt });
      }

      // Walk into command substitutions in arguments
      if (cmd.Args) {
        for (const word of cmd.Args) {
          walkWordParts(word, callback);
        }
      }
      break;
    }

    case "BinaryCmd":
      walkStmt(cmd.X, callback);
      walkStmt(cmd.Y, callback);
      break;

    case "Subshell":
      walkStmts(cmd.Stmts, callback);
      break;

    case "Block":
      walkStmts(cmd.Stmts, callback);
      break;

    case "IfClause":
      if (cmd.Cond) walkStmts(cmd.Cond, callback);
      if (cmd.Then) walkStmts(cmd.Then, callback);
      if (cmd.Else) {
        if (Array.isArray(cmd.Else)) {
          walkStmts(cmd.Else, callback);
        } else {
          // Nested IfClause (elif)
          walkCommand(cmd.Else, parentStmt, callback);
        }
      }
      break;

    case "ForClause":
      if (cmd.Do) walkStmts(cmd.Do, callback);
      break;

    case "WhileClause":
      if (cmd.Cond) walkStmts(cmd.Cond, callback);
      if (cmd.Do) walkStmts(cmd.Do, callback);
      break;

    case "CaseClause":
      if (cmd.Items) {
        for (const item of cmd.Items) {
          if (item.Stmts) walkStmts(item.Stmts, callback);
        }
      }
      break;

    case "FuncDecl":
      if (cmd.Body) walkStmt(cmd.Body, callback);
      break;

    case "TimeClause":
      if (cmd.Stmt) walkStmt(cmd.Stmt, callback);
      break;

    case "CoprocClause":
      if (cmd.Body) walkStmt(cmd.Body, callback);
      break;

    case "DeclClause":
      // declare/export/local — walk args for command substitutions
      if (cmd.Args) {
        for (const word of cmd.Args) {
          walkWordParts(word, callback);
        }
      }
      break;

    // TestClause, LetClause, ArithCmd don't contain nested commands to walk
    case "TestClause":
    case "LetClause":
    case "ArithCmd":
      break;
  }
}

/**
 * Walk into command substitutions within word parts.
 */
function walkWordParts(word: Word, callback: (cmd: ASTCommand) => void): void {
  if (!word?.Parts) return;
  for (const part of word.Parts) {
    if (part.Type === "CmdSubst" && part.Stmts) {
      for (const stmt of part.Stmts) {
        walkStmt(stmt, callback);
      }
    } else if (part.Type === "DblQuoted" && part.Parts) {
      for (const inner of part.Parts) {
        if (inner.Type === "CmdSubst" && inner.Stmts) {
          for (const stmt of inner.Stmts) {
            walkStmt(stmt, callback);
          }
        }
      }
    } else if (part.Type === "ProcSubst" && part.Stmts) {
      for (const stmt of part.Stmts) {
        walkStmt(stmt, callback);
      }
    }
  }
}
