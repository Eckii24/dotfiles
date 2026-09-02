import type { BashRule, BashRuleDecision, GuardrailsConfig } from "./types.js";

export interface BashRuleMatch {
  rule: BashRule;
  decision: BashRuleDecision;
}

/** Return the longest rule whose command tokens prefix the parsed argv. */
export function matchBashRule(
  commandName: string,
  args: string[],
  config: GuardrailsConfig,
): BashRuleMatch | undefined {
  const argv = [commandName, ...args].map((token) => token.toLowerCase());
  let best: BashRule | undefined;

  for (const rule of config.bash?.rules ?? []) {
    if (rule.command.length > argv.length || rule.command.length <= (best?.command.length ?? 0)) continue;
    if (rule.command.every((token, index) => token.toLowerCase() === argv[index])) best = rule;
  }

  return best ? { rule: best, decision: best.decision } : undefined;
}
