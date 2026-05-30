---
name: code-review-excellence
description: "Review code changes for correctness, security, performance, and maintainability. Use when reviewing pull requests, implementation output, or auditing code quality."
---

# Code Review

Review changes systematically. Prioritize impact. Be specific/actionable; no nitpicks while logic is wrong.

## Gather context first

1. Requirements: spec/story/plan/PR description.
2. Changed files and scope.
3. Test/eval signals from plan or relevant commands.
4. Neighboring code patterns for conventions/error handling.

If context is missing, note it as a review limitation/finding.

## Review priority

1. **Correctness**: requirements met, edge cases, null/empty/boundaries, async/races, error paths, contracts.
2. **Security**: validation at trust boundaries, injection, auth/authz, secrets/logging.
3. **Performance**: N+1, hot-path blocking, unbounded results, missing pagination/cache/batching.
4. **Maintainability**: fits codebase patterns, clear names, justified complexity, no premature/parallel abstractions.
5. **Tests**: behavior coverage for happy + meaningful edge paths; deterministic; proportional to risk.

## Severity

- **Blocking**: must fix before merge; correctness/security/data-loss/broken-contract risk.
- **Important**: should fix; meaningful quality/perf/maintainability/test gap.
- **Minor**: nice-to-have style/naming/small simplification.
- **Question**: intent unclear; ask instead of assuming.

## Finding style

Use exact `file:line`, issue, impact, suggested fix. Example:

`src/api/handler.ts:42` — Query is not parameterized, creating SQL injection risk. Use prepared statement.

## Output format

```md
## Summary
[1-3 sentences: scope, overall assessment, top risk.]

## Blocking Issues
- `file:line` — [issue]. [impact]. [fix].

## Important Issues
- `file:line` — [issue]. [rationale/fix].

## Minor Issues / Suggestions
- `file:line` — [suggestion].

## Questions
- `file:line` — [unclear point and why it matters].

## Requirements Compliance
[Met/missing/partial requirements when source exists.]

## Test & Eval Results
[command -> pass/fail + short output summary; or not run + why.]

## Verdict
[Approve / Approve with minor fixes / Request changes] — [1-2 next actions].
```

## Plan-aware review

When a plan exists, check tasks against actual changes, run eval gates when practical, flag skipped/partial tasks, and note intentional deviations.
