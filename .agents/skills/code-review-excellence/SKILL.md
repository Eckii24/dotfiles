---
name: code-review-excellence
description: "Review code changes for correctness, security, performance, and maintainability. Use when reviewing pull requests, implementation output, or auditing code quality."
---

# Code Review

Review code changes systematically. Prioritize findings by impact. Be specific and actionable.

## Before reviewing

Gather context before reading code:

1. **Requirements source**: Read the spec, story, plan, or PR description. Understand what the code is supposed to do.
2. **Changed files**: Identify what changed and the scope of the change.
3. **Test signals**: Check whether tests pass, what coverage looks like, and whether evals from the plan were run.
4. **Codebase patterns**: Look at neighboring code to understand existing conventions, abstractions, and error handling patterns. The change should fit the codebase, not introduce a parallel style.

If any of these are unavailable, note it in your review — missing context is itself a finding.

## What to review

Review in this priority order. Spend proportional time: don't nitpick formatting if the logic is wrong.

### 1. Correctness

- Does the code do what the requirements ask?
- Are edge cases handled? (null, empty, boundary values, concurrent access)
- Are error paths correct — not just present, but producing the right behavior?
- Off-by-one errors, wrong comparisons, missing awaits, race conditions.

### 2. Security

- Input validation and sanitization at trust boundaries.
- Injection risks (SQL, XSS, command injection).
- Authentication/authorization checks where needed.
- Secrets not hardcoded, sensitive data not logged.

### 3. Performance

- N+1 queries, unnecessary loops over large collections.
- Blocking operations in hot paths.
- Missing pagination, unbounded results.
- Expensive operations that should be cached or batched.

### 4. Maintainability

- Does the code follow the codebase's existing patterns and conventions?
- Are names clear? Can someone unfamiliar with the PR understand the intent?
- Is complexity justified? Could the same thing be done more simply?
- Are abstractions appropriate — not premature, not missing where needed?

### 5. Test quality

- Do tests cover the happy path AND meaningful edge cases?
- Do tests verify behavior, not implementation details?
- Are tests deterministic and independent?
- Is coverage proportional to the risk of the change?

## How to report findings

Use severity levels. Be concrete: file path, line reference, what's wrong, why it matters, and what to do instead.

### Severity levels

- **Blocking** — Must fix before merge. Correctness bugs, security issues, data loss risks, broken contracts.
- **Important** — Should fix. Meaningful quality, performance, or maintainability concerns. Discuss if you disagree.
- **Minor** — Nice to have. Style, naming, small simplifications. Not blocking.
- **Question** — Intent is unclear. Ask rather than assume.

### Good vs bad feedback

Bad: "This is wrong."
Good: "`src/api/handler.ts:42` — This query isn't parameterized, creating a SQL injection risk. Use a prepared statement instead."

Bad: "Rename this variable."
Good: "[minor] `userCount` would be clearer than `uc` here, since it's used across three functions."

Bad: "Add error handling."
Good: "[blocking] `fetchUser()` at line 58 doesn't handle a failed HTTP response. If the API returns 4xx/5xx, this will pass `undefined` to `processUser()` and crash. Wrap in try/catch or check `response.ok`."

## Output format

```md
## Summary
[1-3 sentences: what was reviewed, overall assessment, most important finding.]

## Blocking Issues
- `file:line` — [issue]. [impact]. [suggested fix].

## Important Issues
- `file:line` — [issue]. [rationale].

## Minor Issues / Suggestions
- `file:line` — [suggestion].

## Questions
- `file:line` — [what's unclear and why it matters].

## Requirements Compliance
[If a spec/plan/story was provided: which requirements are met, which are missing or partially implemented.]

## Test & Eval Results
[If tests/evals were run: command, result, pass/fail. If not run: note it.]

## Verdict
[Approve / Approve with minor fixes / Request changes — and the 1-2 most important next actions.]
```

## Verify against the plan when one exists

When reviewing implementation that has an associated plan:

- Check each phase's tasks against the actual code changes.
- Run the eval gate commands from the plan and report results.
- Flag any plan tasks that were skipped or only partially implemented.
- Note deviations from the plan — some are fine, but they should be intentional.
