/**
 * Guardrails Extension — Shared Types
 */

/** Configuration for path-based guardrails */
export interface PathsConfig {
  /** Glob patterns for paths that require confirmation before reading */
  confirmRead?: string[];
  /**
   * Glob patterns for paths that are allowed to be written to.
   * - undefined / not set → unrestricted (only confirmWrite applies)
   * - [] (empty array) → no paths are auto-allowed; writes require confirmation
   * - [...patterns] → matching paths are auto-allowed; non-matching writes require confirmation
   */
  allowWrite?: string[];
  /** Glob patterns for paths that require confirmation before writing (takes precedence over allowWrite) */
  confirmWrite?: string[];
}

export type BashRuleDecision = "allow" | "confirm" | "deny";

/** Token-aware bash command rule. The longest matching command prefix wins. */
export interface BashRule {
  /** Command and subcommand tokens, for example ["az", "boards", "work-item", "show"]. */
  command: string[];
  decision: BashRuleDecision;
}

/** Configuration for bash command guardrails */
export interface BashConfig {
  /** Token-aware command rules. The longest matching command prefix wins. */
  rules?: BashRule[];
  /** provider/model id used for the Gate-2 preflight judge */
  preflightModel?: string;
  /** Additive soft rules appended to the Gate-2 preflight prompt. Cannot weaken core policy. */
  preflightRules?: string[];
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
  /** Policy which required confirmation, when applicable */
  confirmationKind?: "confirm-read" | "confirm-write" | "allow-write";
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
  /** Whether the command needs no hard-policy intervention */
  allowed: boolean;
  /** Whether a matching deny rule requires blocking without confirmation */
  denied: boolean;
  /** List of violations found */
  violations: BashViolation[];
}

/** A single violation found in a bash command */
export interface BashViolation {
  /** Type of violation */
  type: "denied_command" | "file_write_detected" | "file_read_detected" | "preflight_flagged";
  /** The command that triggered the violation */
  command: string;
  /** The full command segment */
  segment: string;
  /** Additional details (e.g., target path for file writes) */
  details?: string;
  /** Command-rule decision that produced this violation, when applicable. */
  decision?: "confirm" | "deny";
}

export const DEFAULT_TIMEOUT = 300000; // 5 minutes
