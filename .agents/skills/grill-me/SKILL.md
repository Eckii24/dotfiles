---
name: grill-me
description: Relentlessly interview the user to sharpen a plan, decision, or design. Use only when explicitly asked to grill, stress-test, or deeply clarify thinking. Not for code review, direct implementation, or a bounded question.
disable-model-invocation: true
---

# Grill Me

Run a deliberate design interview. Goal: shared understanding, not premature implementation.

## Contract

- Build a **design tree**: each decision can unlock dependent decisions.
- Separate **facts** from **decisions**. Find facts through code, files, tools, docs, or bounded scouts; ask the user only to decide goals, constraints, priorities, and trade-offs.
- Work in rounds. The **frontier** is the set of decisions whose prerequisites are settled. Ask only frontier questions.
- Do not implement, edit, plan in detail, or create artifacts until the user confirms shared understanding.

## Round loop

1. Inspect the supplied context and available evidence. Resolve retrievable facts first.
2. State the current objective, settled decisions, and remaining decision frontier briefly.
3. Ask every independent frontier question in one round. Do not ask a question whose answer depends on another open question in that same round.
4. For each question give a recommendation and the decisive trade-off:

```md
❓ **Q1 — <decision>**
<precise question>

➡️ **Recommendation:** <recommended answer>.
**Why:** <main trade-off or evidence>.
```

5. In Pi, use `questionnaire` for a round when it improves answering several independent decisions. Do not force it for one simple question. Outside Pi, use the numbered format above.
6. Wait for the user's answers. Recompute the tree and frontier; do not silently fill decision gaps with assumptions.

## Finish

Finish only when the frontier is empty or the user deliberately parks named decisions.

Summarize:

- objective;
- decisions and rationale;
- explicit assumptions and deferred decisions;
- recommended next workflow: direct execution, `/spec`, `/wayfinder`, `/review`, or stop.

Ask whether the user confirms shared understanding. Only after confirmation may the next workflow mutate files or create a plan/spec.

## Boundaries

- **Written code/diff review:** use `/review` and `code-review-excellence`.
- **Small bounded request:** clarify only material gaps; do not start a grilling session.
- **Unclear multi-session initiative:** use `/wayfinder`; it maps facts and decision frontier, not an interview loop.
- **Brutal one-shot critique:** use `roast-me`.
