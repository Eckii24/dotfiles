/**
 * Guardrails Extension — Shared Types
 */

/** Configuration for path-based guardrails */
export interface PathsConfig {
  /** Glob patterns for paths that require confirmation before reading */
  denyRead?: string[];
  /**
   * Glob patterns for paths that are allowed to be written to.
   * - undefined / not set → unrestricted (only denyWrite applies)
   * - [] (empty array) → no paths are auto-allowed; writes require confirmation
   * - [...patterns] → matching paths are auto-allowed; non-matching writes require confirmation
   */
  allowWrite?: string[];
  /** Glob patterns for paths that are denied for writing (takes precedence over allowWrite) */
  denyWrite?: string[];
}

/** Configuration for bash command guardrails */
export interface BashConfig {
  /** Command names that require confirmation before execution */
  deny?: string[];
}

/** Root guardrails configuration */
export interface GuardrailsConfig {
  /** Timeout for confirmation dialogs in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Path-based guardrails for read/write/edit tools */
  paths?: PathsConfig;
  /** Bash command guardrails */
  bash?: BashConfig;
}

/** Result of checking a path against guardrails */
export interface PathCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Whether confirmation is required (true = ask user, false = block outright) */
  requiresConfirmation: boolean;
  /** Human-readable reason */
  reason: string;
  /** The matched pattern that triggered the check */
  matchedPattern?: string;
}

/** A single command extracted from a bash command string */
export interface ExtractedCommand {
  /** The command name (e.g., 'rm', 'sudo', 'cp') */
  name: string;
  /** The full command segment as extracted */
  fullSegment: string;
  /** Arguments to the command */
  args: string[];
}

/** Result of checking a bash command against guardrails */
export interface BashCheckResult {
  /** Whether the command is allowed */
  allowed: boolean;
  /** List of violations found */
  violations: BashViolation[];
}

/** A single violation found in a bash command */
export interface BashViolation {
  /** Type of violation */
  type: "denied_command" | "file_write_detected" | "file_read_detected";
  /** The command that triggered the violation */
  command: string;
  /** The full command segment */
  segment: string;
  /** Additional details (e.g., target path for file writes) */
  details?: string;
}

export const DEFAULT_TIMEOUT = 300000; // 5 minutes
