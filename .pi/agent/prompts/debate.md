---
description: Three-round, four-lens decision debate inspired by Six Thinking Hats
argument-hint: <claim or decision question>
---

Run a disciplined three-round decision debate about this claim or question:

> ${ARGUMENTS:-No claim or decision question was supplied. Ask for exactly one before starting.}

Use this entrypoint for consequential technical, product, operational, or organizational decisions. It produces a decision assessment, not an implementation plan.

## Process owner — blue hat

You are the process owner. Sharpen the decision question, distinguish facts from assumptions, run the rounds, preserve material dissent, and synthesize a recommendation with explicit trade-offs. You do not participate as a fifth evaluator.

## Preconditions

1. Work inside a Herdr-managed Pi pane with `subagent` and `subagent_control` available. If either is unavailable, report the blocker.
2. Require one debatable proposition or decision question. If the supplied input is empty, underspecified, or combines independent decisions, ask for one concise clarification.
3. Collect only decision-relevant context: owner/audience, constraints, success criteria, supplied evidence and sources, plus deadline or reversibility when known. Mark facts, assumptions, and unknowns separately.
4. Launch the four explicit read-only profiles below.

## Panel — four decision lenses

Launch exactly four parallel panelists with `keepOpen: true`. Give each a complete role packet containing:

- `Lens`: its mandate and weighting below;
- `Decision question`: the exact claim/question under debate;
- `Known context and evidence`: supplied or cited facts, assumptions, and missing evidence;
- `Round objective`: exact work for this round;
- `Required output`: the requested headings.

Use these lenses and profiles:

1. **Facts and system fit** — white hat (`debate-context`): evidence, constraints, architecture, dependencies, feasibility, and uncertainty retirement.
2. **Value and delivery** — yellow hat (`debate-value`): outcome, benefit, adoption, team fit, delivery path, and time to useful value.
3. **Safety and sustainability** — black hat (`debate-stewardship`): security, privacy, resilience, lifecycle cost, operations, lock-in, and irreversible commitments.
4. **Alternatives and countercheck** — green hat (`debate-alternatives`): status quo, simpler options, fragile assumptions, counterexamples, falsifiers, and reversible tests.

These are complementary weighting functions, not generic pros-and-cons roles. For a decision with a dominant concern, make that concern explicit in the packet; retain all four lenses.

## Round 1 — independent assessment

Launch all four panelists in parallel. Ask each for:

```markdown
## Position
- Support | oppose | conditional | insufficient evidence

## Decisive reasoning
- At most 3 reasons, weighted by your lens.

## Evidence, assumptions, and unknowns
- Separate each category.

## Material trade-off
- The one issue decision owners must not miss.

## What would change my mind
- Concrete evidence, measurement, or condition.
```

Wait for trusted native finals from all four. If a child is blocked, report the visible resolution needed before continuing.

## Round 2 — cross-lens examination

Create a compact anonymized lens map from Round 1. Preserve the four lens labels; keep quotations compact.

Send the same lens map to each successful retained leaf using one explicit `subagent_control.follow_up` per leaf. Ask each for:

```markdown
## Updated position
- Changed | unchanged, then current position.

## Strongest other-lens point
- Steelman one other lens fairly.

## Rebuttal or concession
- What survives scrutiny; what does not.

## Priority conflict
- Which competing priority needs an explicit decision by the owner.

## Evidence gap
- One missing fact most likely to change the decision.
```

## Round 3 — resolution

Create a compact unresolved-claims map from Round 2. Send it to every successful retained leaf with one explicit `follow_up` per leaf. Ask each for:

```markdown
## Final recommendation
- One clear recommendation or explicit no-decision.

## Decision conditions
- Preconditions, guardrails, or reversible validation needed.

## Residual risk
- Most important risk still open.

## Confidence
- High | medium | low, with one sentence why.
```

Preserve material dissent. Agreement is not proof.

## Main synthesis

After trusted Round-3 finals, return:

```markdown
## Decision
- Recommended action, or explicit no-decision.

## Why
- 2–4 decisive reasons, attributed to the relevant lens.

## Consensus and priority conflicts
- Genuine agreement versus unresolved trade-offs.

## Assumptions and evidence gaps
- Facts still required before commitment.

## Guardrails / next test
- Smallest reversible validation step, owner if known.

## Confidence
- High | medium | low, with reason.
```

Never present repetition of an unsupported premise as consensus.

## Cleanup

Keep child panes open through all three rounds. After the main synthesis, close the retained root with `subagent_control.close` unless the user explicitly asks to inspect or continue the panel. Report any ownership/cleanup warning exactly; never claim a pane closed without the control result.
