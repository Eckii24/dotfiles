import { sanitizeSessionAllowedCommand } from "./preflight.js";

const MAX_APPROVALS = 20;
const MAX_INTENT_CHARS = 300;

export interface SessionPreflightApproval {
  scope: string;
  command: string;
  intent: string;
  reason: string;
  riskSignals: string[];
  createdAt: string;
}

function normalizeIntent(value: string): string | undefined {
  const intent = value.replace(/\s+/g, " ").trim();
  if (!intent || intent.toLowerCase() === "none" || intent.length > MAX_INTENT_CHARS) return undefined;
  return intent;
}

export class SessionPreflightApprovals {
  private readonly values: SessionPreflightApproval[] = [];

  add(input: Omit<SessionPreflightApproval, "command" | "createdAt"> & { command: string; createdAt?: string }): SessionPreflightApproval | undefined {
    const intent = normalizeIntent(input.intent);
    if (!intent || this.values.length >= MAX_APPROVALS) return undefined;

    const command = sanitizeSessionAllowedCommand(input.command);
    const existing = this.values.find((approval) => approval.scope === input.scope && approval.command === command && approval.intent === intent);
    if (existing) return existing;

    const approval: SessionPreflightApproval = {
      scope: input.scope,
      command,
      intent,
      reason: input.reason.trim().slice(0, MAX_INTENT_CHARS),
      riskSignals: [...new Set(input.riskSignals)].slice(0, 10),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.values.push(approval);
    return approval;
  }

  approvalsForScope(scope: string): SessionPreflightApproval[] {
    return this.values.filter((approval) => approval.scope === scope).map((approval) => ({ ...approval, riskSignals: [...approval.riskSignals] }));
  }

  clear(): void {
    this.values.length = 0;
  }

  get size(): number {
    return this.values.length;
  }
}
