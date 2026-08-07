---
name: ai-review-comments
description: "Process open .ai-review.json code-review comments in the current Git repository when the user explicitly asks to work through, resolve, or inspect those comments."
disable-model-invocation: true
---

# AI Review Comments

**User-initiated only.** This skill is excluded from automatic model invocation. Use it only after the user explicitly asks to process, inspect, or resolve `.ai-review.json` comments.

## Contract

`.ai-review.json` is a repository-local review-task store:

- Missing `status` means `open` (backward compatible).
- Work only comments whose `status` is `open`.
- Preserve comment identity, body, and location. Do not delete review comments as a substitute for resolving them.
- Treat `file`, `line`, and `side` as an anchor, not unquestionable truth. Confirm the relevant current code and diff before changing anything.
- `side: "left"` refers to pre-change code. Locate the corresponding current code or diff hunk before acting.

## Workflow

1. Find the Git root and read `<git-root>/.ai-review.json`.
   - If absent: report that there are no persisted review comments; do not create the file.
   - If invalid JSON: stop and report the parse error. Do not overwrite it.
2. List open comments briefly: ID, file, line, side, and body. Identify stale/missing anchors or ambiguous requests before modifying code.
3. For each comment the user asked to handle:
   - inspect the referenced code and relevant diff;
   - implement only the requested or clearly implied change;
   - run the narrowest meaningful verification, then broader relevant checks when proportionate.
4. Resolve a comment only when its requested outcome is actually satisfied and verification supports that claim. Update it as:

```json
{
  "status": "resolved",
  "resolution": "What changed; verification actually run and result.",
  "resolved_at": "UTC ISO-8601 timestamp",
  "resolved_by": "ai"
}
```

5. If blocked, ambiguous, out of scope, or verification fails: keep `status: "open"`. Do not claim resolution. Report the blocker and, if helpful, append a factual note to `resolution` without changing the status.
6. Write the JSON deterministically and preserve valid JSON. Afterwards reread it and verify that only intended comment records changed.

## Resolution quality

A resolution is evidence, not a checkbox. Include:

- concrete code/configuration change;
- command or verification performed and its outcome;
- a limitation, if verification was not possible.

Good: `Added null-input guard in Parser.cs; dotnet test tests/Parser.Tests passed.`

Bad: `Done.` / `Fixed.` / a test result that was not run.

## Boundaries

- This file is not a replacement for Taskwarrior or a general backlog.
- Do not resolve every open comment opportunistically. Process only the scope the user requested.
- Do not mark a comment resolved merely because the original line moved, vanished, or appears superficially changed.
- Do not change a comment's `body` to record the result; use `resolution`.
- If the repository has its own contribution/test instructions, follow them in addition to this skill.

## Completion report

Report resolved IDs, remaining open IDs/blockers, changed paths, and exact verification evidence.
