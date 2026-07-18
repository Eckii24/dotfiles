const MAX_RULES = 20;
const MAX_RULE_CHARS = 500;

function isUnsafeRuleText(rule: string): boolean {
  return /[\r\n\u2028\u2029\t\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rule) ||
    /\[\/?PREFLIGHT_VERDICT\]|```|\b(?:DECISION|REASON|CONCERNS):/i.test(rule) ||
    /\b(?:ignore|disregard|forget|override)\b.*\b(?:instruction|policy|rule|above|previous|prior)\b/i.test(rule) ||
    /\balways\s+(?:allow|approve)\b/i.test(rule) ||
    /\b(?:return|output|respond)\b.*\b(?:allow|deny|confirm|verdict|decision)\b/i.test(rule);
}

export class SessionPreflightRules {
  private readonly values: string[] = [];

  add(input: string): { added: boolean; error?: string } {
    const rule = input.trim();
    if (!rule) return { added: false, error: "Rule must not be empty" };
    if (rule.length > MAX_RULE_CHARS) return { added: false, error: `Rule must be at most ${MAX_RULE_CHARS} characters` };
    if (isUnsafeRuleText(rule)) return { added: false, error: "Rule contains unsafe policy-control text" };
    if (this.values.includes(rule)) return { added: false, error: "Rule already exists" };
    if (this.values.length >= MAX_RULES) return { added: false, error: `At most ${MAX_RULES} session rules are allowed` };
    this.values.push(rule);
    return { added: true };
  }

  get rules(): string[] {
    return [...this.values];
  }
}
