/**
 * Guardrails Extension — Path Guard
 *
 * Checks paths against denyRead / allowWrite / denyWrite glob patterns.
 *
 * Path resolution matches Pi's built-in tool behavior:
 * - Strip leading '@' prefix (some models add it)
 * - Expand '~' to home directory
 * - Normalize unicode spaces
 * - Resolve relative paths against cwd
 * - Canonicalize via realpath for symlink protection
 *
 * Both the lexical path AND the canonical path are checked against patterns.
 * A match on either means the rule applies.
 */

import { resolve, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { realpathSync } from "node:fs";
import type { GuardrailsConfig, PathCheckResult } from "./types.js";

// ─── Path normalization (matches Pi's path-utils.ts) ───

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Expand a file path the same way Pi's built-in tools do:
 * 1. Strip leading '@'
 * 2. Normalize unicode spaces
 * 3. Expand '~' to home directory
 */
export function expandPath(filePath: string): string {
  // Strip leading @ (some models prefix paths with @)
  let p = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  // Normalize unicode spaces to regular spaces
  p = p.replace(UNICODE_SPACES, " ");
  // Expand ~
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

/**
 * Resolve a file path to an absolute path, matching Pi's resolveToCwd.
 */
export function resolvePath(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  if (expanded.startsWith("/")) return expanded;
  return resolve(cwd, expanded);
}

/**
 * Canonicalize a path via realpath. For existing files, resolves symlinks.
 * For non-existent files, canonicalizes the nearest existing parent directory
 * and appends the remaining path components.
 *
 * Returns undefined if canonicalization fails entirely.
 */
function canonicalizePath(absolutePath: string): string | undefined {
  try {
    return realpathSync(absolutePath);
  } catch {
    // File doesn't exist yet — canonicalize the parent
    const dir = dirname(absolutePath);
    const base = basename(absolutePath);
    try {
      return resolve(realpathSync(dir), base);
    } catch {
      // Try one more level up
      const parentDir = dirname(dir);
      const dirBase = basename(dir);
      try {
        return resolve(realpathSync(parentDir), dirBase, base);
      } catch {
        // Give up — return undefined, we'll check lexical path only
        return undefined;
      }
    }
  }
}

// ─── Glob matching ───

/**
 * Convert a glob pattern to a RegExp.
 * Supports: *, **, ?, {a,b}, character classes [abc]
 */
function globToRegex(pattern: string): RegExp {
  // Expand ~ to home directory in patterns
  let p = pattern.replace(/^~/, homedir());

  const isAbsolute = p.startsWith("/");
  const isGlobstar = p.startsWith("**");

  let regexStr = "";
  let i = 0;

  while (i < p.length) {
    const char = p[i];
    const next = p[i + 1];

    if (char === "*" && next === "*") {
      if (p[i + 2] === "/") {
        regexStr += "(?:.*/)?";
        i += 3;
      } else {
        regexStr += ".*";
        i += 2;
      }
    } else if (char === "*") {
      regexStr += "[^/]*";
      i++;
    } else if (char === "?") {
      regexStr += "[^/]";
      i++;
    } else if (char === "{") {
      const closeIdx = p.indexOf("}", i);
      if (closeIdx !== -1) {
        const alternatives = p.slice(i + 1, closeIdx).split(",");
        regexStr += "(?:" + alternatives.map(escapeRegex).join("|") + ")";
        i = closeIdx + 1;
      } else {
        regexStr += escapeRegex(char);
        i++;
      }
    } else if (char === "[") {
      const closeIdx = p.indexOf("]", i);
      if (closeIdx !== -1) {
        regexStr += p.slice(i, closeIdx + 1);
        i = closeIdx + 1;
      } else {
        regexStr += escapeRegex(char);
        i++;
      }
    } else {
      regexStr += escapeRegex(char);
      i++;
    }
  }

  // If not absolute and not starting with **, match anywhere in path
  if (!isAbsolute && !isGlobstar) {
    regexStr = "(?:^|.*/?)" + regexStr;
  }

  return new RegExp("^" + regexStr + "$");
}

function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|\\]/g, "\\$&");
}

/**
 * Check if a path matches any pattern. Resolves relative patterns against cwd.
 * Returns the first matching pattern, or undefined.
 */
function matchesAnyPattern(filePath: string, patterns: string[], cwd: string): string | undefined {
  for (const pattern of patterns) {
    let resolvedPattern = pattern;
    if (!pattern.startsWith("/") && !pattern.startsWith("~") && !pattern.startsWith("**")) {
      resolvedPattern = resolve(cwd, pattern);
    }
    const regex = globToRegex(resolvedPattern);
    if (regex.test(filePath)) {
      return pattern;
    }
  }
  return undefined;
}

/**
 * Check a path against patterns, testing BOTH the lexical and canonical forms.
 * A match on either means the pattern applies.
 */
function matchesAnyPatternWithCanonical(
  lexicalPath: string,
  canonicalPath: string | undefined,
  patterns: string[],
  cwd: string,
): string | undefined {
  const lexicalMatch = matchesAnyPattern(lexicalPath, patterns, cwd);
  if (lexicalMatch) return lexicalMatch;

  if (canonicalPath && canonicalPath !== lexicalPath) {
    return matchesAnyPattern(canonicalPath, patterns, cwd);
  }

  return undefined;
}

// ─── Public API ───

/**
 * Check if a read operation is allowed for the given path.
 */
export function checkRead(filePath: string, cwd: string, config: GuardrailsConfig): PathCheckResult {
  const absolutePath = resolvePath(filePath, cwd);
  const canonical = canonicalizePath(absolutePath);
  const denyRead = config.paths?.denyRead;

  if (!denyRead || denyRead.length === 0) {
    return { allowed: true, requiresConfirmation: false, reason: "No denyRead rules" };
  }

  const matched = matchesAnyPatternWithCanonical(absolutePath, canonical, denyRead, cwd);
  if (matched) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reason: `Path matches denyRead pattern: ${matched}`,
      matchedPattern: matched,
    };
  }

  return { allowed: true, requiresConfirmation: false, reason: "Path not in denyRead" };
}

/**
 * Check if a write/edit operation is allowed for the given path.
 */
export function checkWrite(filePath: string, cwd: string, config: GuardrailsConfig): PathCheckResult {
  const absolutePath = resolvePath(filePath, cwd);
  const canonical = canonicalizePath(absolutePath);
  const allowWrite = config.paths?.allowWrite;
  const denyWrite = config.paths?.denyWrite;

  // 1. Check denyWrite first (always wins)
  if (denyWrite && denyWrite.length > 0) {
    const denyMatch = matchesAnyPatternWithCanonical(absolutePath, canonical, denyWrite, cwd);
    if (denyMatch) {
      return {
        allowed: false,
        requiresConfirmation: true,
        reason: `Path matches denyWrite pattern: ${denyMatch}`,
        matchedPattern: denyMatch,
      };
    }
  }

  // 2. Check allowWrite if defined (even empty array = deny all)
  if (allowWrite !== undefined) {
    if (allowWrite.length === 0) {
      // Explicit empty whitelist = deny all writes
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: "allowWrite is empty — all writes denied",
      };
    }

    // Check if lexical or canonical path matches any allow pattern
    const lexAllow = matchesAnyPattern(absolutePath, allowWrite, cwd);
    const canAllow = canonical && canonical !== absolutePath
      ? matchesAnyPattern(canonical, allowWrite, cwd)
      : undefined;

    if (!lexAllow && !canAllow) {
      return {
        allowed: false,
        requiresConfirmation: false,
        reason: "Path not in allowWrite list",
      };
    }
  }

  // 3. Allowed
  return { allowed: true, requiresConfirmation: false, reason: "Path allowed" };
}

/**
 * Check if a path matches denyWrite (used by bash guard for file operations).
 */
export function matchesDenyWrite(filePath: string, cwd: string, config: GuardrailsConfig): string | undefined {
  const absolutePath = resolvePath(filePath, cwd);
  const canonical = canonicalizePath(absolutePath);
  const denyWrite = config.paths?.denyWrite;
  if (!denyWrite || denyWrite.length === 0) return undefined;
  return matchesAnyPatternWithCanonical(absolutePath, canonical, denyWrite, cwd);
}

/**
 * Check if a path matches denyRead (used by bash guard for read commands).
 */
export function matchesDenyRead(filePath: string, cwd: string, config: GuardrailsConfig): string | undefined {
  const absolutePath = resolvePath(filePath, cwd);
  const canonical = canonicalizePath(absolutePath);
  const denyRead = config.paths?.denyRead;
  if (!denyRead || denyRead.length === 0) return undefined;
  return matchesAnyPatternWithCanonical(absolutePath, canonical, denyRead, cwd);
}

/**
 * Check if a write to a path would violate allowWrite (used by bash guard).
 * Returns a reason string if blocked, undefined if OK.
 */
export function checkAllowWrite(filePath: string, cwd: string, config: GuardrailsConfig): string | undefined {
  const allowWrite = config.paths?.allowWrite;
  if (allowWrite === undefined) return undefined; // unrestricted

  if (allowWrite.length === 0) {
    return "allowWrite is empty — all writes denied";
  }

  const absolutePath = resolvePath(filePath, cwd);
  const canonical = canonicalizePath(absolutePath);

  const lexAllow = matchesAnyPattern(absolutePath, allowWrite, cwd);
  const canAllow = canonical && canonical !== absolutePath
    ? matchesAnyPattern(canonical, allowWrite, cwd)
    : undefined;

  if (!lexAllow && !canAllow) {
    return "Path not in allowWrite list";
  }

  return undefined;
}
