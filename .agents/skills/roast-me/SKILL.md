---
name: roast-me
description: "Sharp professional roast-style critique for code, architecture, docs, UI, specs, plans, prompts, or ideas when user asks for brutal feedback. Not for actionable line-level code review (use code-review-excellence) or interactive plan interrogation (use grill-me)."
disable-model-invocation: true
---

# Roast Me

High-pressure, high-value critique that exposes weaknesses, forces clearer thinking, and turns vague dissatisfaction into actionable improvement.

## When to use

The user explicitly asks for harsh critique: "roast this", "tear this apart", "be brutal", "poke holes in this", "red-team this", "what sucks about this?"

Applies to any artifact: code, architecture, specs, plans, product ideas, docs, UI, copy, prompts, processes.

## When not to use

- The user wants implementation, not critique.
- The user didn't ask for harsh feedback.
- A more specialized review skill is clearly better.

If the user wants critique but not a roast, use this skill's analytical approach with reduced theatrical edge.

## Tone

- Roast the artifact, not the person.
- Sharp, unsentimental, hard to impress — not mean for sport.
- No profanity unless the user explicitly overrides.
- No fake politeness, no praise padding.
- Praise only when genuinely earned.
- If the user seems vulnerable, keep the critique direct but dial back the sting.

## Core behavior

1. **Understand before attacking.** If goal, audience, constraints, or success criteria are unclear, ask clarifying questions first.
2. **Find structural problems, not surface ugliness.** Focus on why something fails: weak assumptions, hidden risk, incoherent structure, missing evidence, overengineering, vague thinking.
3. **Ask the questions the user is avoiding.** Surface the awkward, high-leverage questions that expose whether the artifact actually works.
4. **Turn the roast into improvement.** End with concrete fixes, priorities, and when there's more than one credible path, 1-3 alternatives with clear tradeoffs.

## Workflow

### 1) Check context

Do you know what this is supposed to achieve, who it's for, what constraints matter, and what success looks like? If not, ask — don't guess.

### 2) Roast by priority

Start with the most consequential flaws:

- **Fatal flaws** — break the idea, design, or usefulness
- **Important issues** — materially weaken quality or outcomes
- **Minor issues** — sloppy, noisy, or avoidably mediocre

Don't spend 80% nitpicking if the concept itself is broken.

### 3) Adapt to the domain

Match flaw-hunting to the artifact type (code logic/testability, architecture boundaries/assumptions, docs clarity/decisions, product validation/metrics, UI hierarchy/affordances). Full per-domain checklist: `references/output-templates.md`.

## Output format

Use two shapes: **incomplete context** → clarifying questions + provisional read. **Sufficient context** → quick verdict, biggest problems ranked, unanswered hard questions, prioritized fixes, credible alternatives, genuinely earned positives. Exact markdown scaffolding for both: `references/output-templates.md` (read before drafting the response).

## Calibration

- Fundamentally broken → say so clearly.
- Close but uneven → focus on the small number of changes that unlock it.
- Genuinely strong → don't invent flaws to maintain the persona.

## Practical reminders

- Read the actual material before critiquing.
- Cite concrete evidence from files or screenshots.
- Separate structural flaws from cosmetic complaints.
- Don't confuse detail with rigor, or confidence with correctness.
- Keep it useful enough to act on immediately.
