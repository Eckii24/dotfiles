---
name: code-review-excellence
description: "Review a concrete change against an explicit focus: plan/spec fidelity, correctness, security, performance, tests, maintainability, architecture, or full review. Use for PRs, branches, implementation output, and targeted risk reviews. Not for grilling a design or debugging a live failure."
---

# Focused Code Review

A review needs a declared question. "Review this" means **full review**; otherwise review only the named concern. Do not bury a performance finding beneath generic style noise.

## Input contract

Before reviewing, establish:

1. **Fixed point and scope** — commit, branch, merge-base, file range, or explicit artifacts.
2. **Focus** — one of:
   - `plan/spec`: required behavior, acceptance criteria, scope creep;
   - `correctness`: contracts, edge cases, concurrency, failure paths;
   - `security`: trust boundaries, auth/authz, injection, secrets, unsafe effects;
   - `performance`: measured or plausible hot paths, N+1, blocking, bounds, allocation/I/O;
   - `tests`: behavior coverage, regression protection, determinism, test seam;
   - `maintainability`: naming, locality, unnecessary complexity, duplicate/parallel abstractions;
   - `architecture`: module boundaries, coupling, ownership, migration/operability;
   - `full`: all relevant axes, kept separately.
3. **Evidence packet** — relevant spec/plan, changed paths and symbols, existing evaluation results, and any user-stated risk.

If the fixed point, focus, or needed source is absent, report that as a review limitation. Do not invent requirements.

## Review process

1. Read only the evidence needed for the focus. For `plan/spec`, trace every stated acceptance criterion to code and verification evidence.
2. Inspect the diff and neighboring code at the required seam.
3. Run relevant existing checks when practical. For a performance review, do not manufacture certainty from static inspection: distinguish measured regression, credible risk, and unverified concern.
4. Apply the finding admission gate. Report an issue only when all hold:
   - concrete failure mode or violated requirement;
   - realistic reachability from the reviewed scope;
   - practical impact;
   - existing safeguards considered;
   - proportionate action justified now.
5. In `full` review, keep findings grouped by focus. Do not merge spec fidelity, standards, security, and performance into one undifferentiated list.

## Severity

- **Blocking** — must fix before merge: correctness, security, data loss, broken contract, or migration risk.
- **Important** — should fix: meaningful performance, reliability, maintainability, or test gap.
- **Minor** — bounded low-risk simplification.
- **Question** — intent or evidence missing; ask instead of assuming.

## Output

```md
## Review Scope
- Fixed point:
- Focus:
- Sources/evidence reviewed:
- Limitations:

## Findings
### Blocking
- `path:line` — [focus] [issue]. [failure mode/impact]. [proportionate fix].

### Important
- `path:line` — [focus] [issue]. [rationale/fix].

### Minor
- `path:line` — [focus] [suggestion].

### Questions
- `path:line` — [what is unknown and why it matters].

## Focus Verdict
[Pass | Concerns | Blocked] — [short evidence-based conclusion].

## Eval Evidence
- `command` → pass/fail + concise signal; or not run + why.

## Next Action
[One exact next action. Do not auto-fix.]
```

## Review profiles

### Plan/spec implementation
Compare the diff against the source spec/plan separately from code quality. Report missing requirements, partial behavior, scope creep, and unverifiable acceptance criteria before maintainability concerns.

### Performance
Start from workload and measurement. Inspect bounds, query count, allocations, I/O, contention, retries, and caching. Label static-only claims as risks, not regressions. Require a benchmark/profile before blocking unless the cost is self-evidently catastrophic.

### Full
Review, in separate sections: plan/spec fidelity, correctness, security, performance, maintainability/architecture, and tests. Skip axes unsupported by the scope rather than padding the report.

## Boundaries

- **Unresolved design:** `grill-me`.
- **Live failure/root cause:** `debugging`.
- **Brutal one-shot critique:** `roast-me`.
- **No concrete change or fixed point:** ask for one; do not perform a vague audit.
