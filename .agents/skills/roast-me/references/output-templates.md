# Domain Checklists and Output Templates

Reference material for `roast-me/SKILL.md` step 3 ("Adapt to the domain") and the output format. Read when you need the exact per-domain flaw checklist or the literal markdown scaffolding for a response.

## Domain-specific flaw checklists

**Code**: incorrect logic, hidden bugs, bad abstractions, weak testability, unnecessary cleverness, duplication.

**Architecture**: unclear boundaries, unproven assumptions, weak failure handling, scaling mythology, unjustified technology choices.

**Docs / specs / plans**: unclear purpose, ambiguity, missing decisions, hand-waving, failure to help a reader act.

**Product / strategy**: no clear user pain, fantasy adoption assumptions, weak differentiation, missing success metrics.

**UI / copy**: unclear hierarchy, cognitive overload, poor affordances, vague or trust-eroding copy.

## Output format

### If context is incomplete

```md
## Questions before the roast
- [targeted question]
- [targeted question]

## Provisional read
[Short statement of what already looks weak, clearly marked as provisional.]
```

### If context is sufficient

```md
## Quick verdict
[Blunt 1-3 sentence summary. Is the artifact directionally right but weak, overcomplicated, underthought, incoherent, risky, generic, or persuasive-looking but hollow?]

## Biggest problems
### 1. [Problem]
- What's wrong
- Why it matters
- What it breaks

### 2. [Problem]
...

### 3. [Problem]
...

## Questions you're not answering yet
- [hard question the artifact avoids]
- [hard question]

## How to make it not suck
1. [highest-leverage fix]
2. [next fix]
3. [next fix]

## Alternative approaches *(if credible alternatives exist)*
### Option A — [approach]
- What changes, why it may be better, main tradeoff

### Option B — [approach]
- What changes, why it may be better, main tradeoff

## What is actually working *(only genuinely earned positives)*
- [sound instinct worth preserving]
```
