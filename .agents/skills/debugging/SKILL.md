---
name: debugging
description: Diagnose a bug, failing test, regression, or performance problem before fixing it. Use when something is broken, failing, wrong, slow, or intermittently unreliable. Not for implementing a known bounded change.
---

# Debugging

Find root cause before fixing. A plausible patch without a red-capable feedback loop is guessing.

## Contract

- **No fix before evidence:** do not change production code, configuration, or policy before a reproducible feedback loop and a root-cause hypothesis exist.
- Prefer a narrow, agent-runnable signal that detects the user's exact symptom.
- In multi-component systems, isolate the failing boundary before blaming task logic.
- Fix the cause, prove the original scenario is green, and leave a regression guard where a correct test seam exists.

## Phase 1 — Build a tight feedback loop

Spend disproportionate effort here. Completion requires one command or repeatable probe already run at least once.

Try in this order where applicable:

1. focused failing unit/integration/e2e test;
2. fixture-driven CLI or HTTP probe with expected output;
3. captured trace/event/session replay;
4. minimal throwaway harness around the failing seam;
5. deterministic differential or bisection harness;
6. for flaky failures, a bounded stress loop that raises reproduction rate.

The loop must be:

- **red-capable**: asserts the reported symptom, not merely absence of a crash;
- **deterministic** or explicitly measured for a flaky rate;
- **fast** enough to rerun repeatedly;
- **agent-runnable** without hidden manual steps.

If no loop can be built, stop. Report what was tried and ask for the missing environment access, artifact, or approval for temporary instrumentation. Do not hypothesize from code-reading alone.

## Phase 2 — Reproduce and minimize

Run the loop until it demonstrates the actual reported failure. Capture the exact error, wrong output, or timing.

Remove inputs, callers, configuration, and setup one at a time until every remaining element is load-bearing. Keep the minimized repro as the preferred regression candidate.

## Phase 3 — Investigate and hypothesize

1. Read the full error and relevant recent changes.
2. Trace the failing data/control path upstream to its source.
3. Find analogous working paths and list material differences.
4. For shared signatures across unrelated tasks, first test a provider/runtime/configuration cause: same model, endpoint, extension, transport, or process boundary.
5. Write 3–5 ranked, falsifiable hypotheses. Each must state a prediction:

```text
If <cause> is true, then <specific probe/change> will <observable result>.
```

Test one variable at a time, highest-value hypothesis first. Show the ranked list to the user when domain knowledge can materially re-rank it; otherwise continue with the stated ranking.

## Phase 4 — Instrument precisely

Map each probe to a hypothesis. Prefer debugger/REPL inspection, then narrowly placed tagged logs at discriminating boundaries. Never "log everything".

For a performance regression, measure first: baseline, profile/query plan/timing harness, then compare after each isolated change.

## Phase 5 — Fix and prove

1. Turn the minimized repro into a failing regression test when there is a correct seam.
2. Verify it fails for the expected reason.
3. Apply the smallest root-cause fix.
4. Verify the regression test and the original feedback loop pass.
5. Run relevant broader checks.

If no correct test seam exists, record that as an architectural limitation instead of manufacturing a shallow test.

After two failed repair attempts for the same hypothesis space, stop and return to evidence. After three distinct failed fixes, discuss whether the architecture or interface is the root problem before attempting a fourth.

## Phase 6 — Cleanup and handoff

Before declaring success:

- rerun the original feedback loop;
- remove tagged instrumentation and throwaway probes, or preserve an intentional reproducible harness;
- state root cause, fix, regression evidence, and any remaining limitation;
- propose an architecture follow-up only when evidence shows poor seams, hidden coupling, or repeated recurrence.

## Boundaries

- **Known small code change:** use implementation workflow and TDD as appropriate.
- **Pre-implementation uncertainty:** use `grill-me`, `/spec`, or `/wayfinder`.
- **Reviewing a completed diff:** use `/review`.
