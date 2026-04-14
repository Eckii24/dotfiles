---
goal: Preserve the completed Phase 1 guardrails redesign and execute the approved Phase 2 classifier-only slice with an inline `pi -p` subprocess and configurable classifier model.
date_created: 2026-04-06
date_updated: 2026-04-06
status: Completed
tags: feature, security, guardrails, classifier
---

# Guardrails Permission Redesign — Implementation Plan

This plan preserves the completed Phase 1 record as the locked baseline and defines the immediate Phase 2 execution slice. Phase 2 scope is fixed and approved: classifier layer only, inline `pi -p` subprocess call with command plus local context, configurable classifier model, same slug/artifacts, and direct continuation into implementation unless a true blocker appears.

## Requirements & Constraints

- Treat `.ai/guardrails-permission-redesign-spec.md` as the approved source of truth for both the completed Phase 1 baseline and the new Phase 2 classifier slice.
- Preserve all landed Phase 1 behavior unless a change is strictly additive for classifier integration.
- Phase 2 is limited to the classifier layer only; `onlyIfExists` and named rule IDs remain deferred.
- The classifier must run only for bash commands that pass deterministic checks and only when guardrails are enabled and `ctx.hasUI === true`.
- The classifier must be opt-in, fail-open, and must not weaken hard-deny, rule-based bash violations, path protections, runtime disable support, or no-UI blocking.
- The classifier implementation must use an inline `pi -p` subprocess, not a direct SDK/API client.
- The subprocess invocation must use text stdout capture and include `--no-tools`, `--no-extensions`, `--no-session`, `--no-skills`, `--no-prompt-templates`, `--system-prompt`, `--provider`, and `--model`.
- Update artifacts under the existing slug (`guardrails-permission-redesign`) rather than creating new feature artifacts.
- Continue directly into implementation after this plan update; do not add another approval stop unless a true blocker appears.

## Phase 1 — Completed Record (Preserved Baseline)

Phase 1 is complete and review-clean. The items below stay preserved as the baseline for Phase 2 work.

| Record | Status |
|------|--------|
| Scoped session approvals keyed by exact `(violationType, violationKey)` | ✅ Complete |
| AST traversal fixes for assignment command substitutions and case-word walking | ✅ Complete |
| Recursive path canonicalization and command-aware read/write detection | ✅ Complete |
| Bash confirmation UI full-command rendering | ✅ Complete |
| Protection levels, `bash.hardDeny`, runtime disable support, and custom events | ✅ Complete |
| Regression suite across guardrails modules | ✅ Complete |

### Phase 1 Completed Evals

| What | Result | Command |
|------|--------|---------|
| AST + bash regression slice | `69 pass, 0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/shell-ast.test.ts extensions/guardrails/bash-guard.test.ts` |
| Full guardrails regression suite | `113 pass, 0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/*.test.ts` |

Expected outputs:

**AST + bash regression slice**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/shell-ast.test.ts extensions/guardrails/bash-guard.test.ts
...
69 pass, 0 fail
```

**Full guardrails regression suite**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/*.test.ts
...
113 pass, 0 fail
```

### Phase 1 Review Gate Outcome

- Review outcome is clean: no Critical Issues, no Warnings.
- Runtime disable support, protection-level normalization, scoped approvals, and custom event payloads are the locked contract for Phase 2.
- Phase 2 must remain additive in `index.ts`; deterministic bash and path checks stay the first-line enforcement path.

## Phase 2 — Classifier-Only Execution Slice

### Phase 2.1 — Add classifier types, config, and subprocess module

| Task | Description | Done |
|------|-------------|------|
| 2.1.1 | Update `extensions/guardrails/types.ts` to add `classifier_flagged` to `BashViolationType`, extend `SessionApprovalType`, add `ClassifierRiskLevel`, `ClassifierPromptThreshold`, `ClassifierConfig`, `ClassifierContext`, and `ClassifierResult`, and extend `GuardrailsConfig` plus `GuardrailsEventPayload.action` with classifier-specific action values. | |
| 2.1.2 | Update `extensions/guardrails/config.ts` and `extensions/guardrails/config.test.ts` so `classifier` is validated and merged as a whole-object override. Enforce: disabled by default, `model` required when enabled, `provider/model-id` format, `timeout` default `5000`, `promptThreshold` limited to `high`/`medium`, and `showExplanation` default `true`. Invalid classifier config must log a validation error and resolve to disabled behavior. | |
| 2.1.3 | Create `extensions/guardrails/classifier.ts` as a leaf module that: builds the hardcoded classifier system prompt; builds the user prompt from raw command, effective cwd, and active deny patterns; derives `--provider` and `--model` from `classifier.model`; spawns the inline `pi -p` subprocess with timeout handling; strips markdown fences if present; validates/normalizes JSON stdout; and returns `ClassifierResult | null` on timeout/error/parse failure/disabled state. | |
| 2.1.4 | Add `extensions/guardrails/classifier.test.ts` covering prompt construction, CLI argument construction, `provider/model` splitting, markdown-fence stripping, malformed JSON handling, missing/invalid `risk` handling, default explanation/category filling, timeout fail-open behavior, and subprocess error handling. Keep the subprocess fully mocked; do not hit a live model in automated tests. | |
| 2.1.5 | Confirm the `pi` CLI contract used by the classifier against the current runtime (`pi --help`) and encode any executable-resolution logic in `classifier.ts` behind a small helper so it stays unit-testable. | |

#### Review Gate

- `extensions/guardrails/classifier.ts` is a leaf dependency and does not import from `extensions/guardrails/index.ts`.
- The classifier prompt includes only the raw command and approved local context; it does not include file contents, environment values, or other sensitive runtime data.
- The subprocess args match the approved contract: `-p`, `--system-prompt`, `--provider`, `--model`, `--no-tools`, `--no-extensions`, `--no-session`, `--no-skills`, `--no-prompt-templates`.
- Invalid classifier config degrades to disabled behavior instead of partially enabling a broken subprocess path.

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Config + classifier unit tests | `0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/config.test.ts extensions/guardrails/classifier.test.ts` |
| `pi -p` CLI contract still matches plan assumptions | Help output contains required flags | `cd /Users/matthias.eck/.pi/agent && pi --help 2>&1 | grep -E -- '--print, -p|--system-prompt|--no-tools|--no-extensions|--no-session|--no-skills|--no-prompt-templates|--provider|--model'` |

Expected outputs:

**Config + classifier unit tests**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/config.test.ts extensions/guardrails/classifier.test.ts
bun test v1.3.10
...
0 fail
```

**`pi -p` CLI contract still matches plan assumptions**
```text
$ cd /Users/matthias.eck/.pi/agent && pi --help 2>&1 | grep -E -- '--print, -p|--system-prompt|--no-tools|--no-extensions|--no-session|--no-skills|--no-prompt-templates|--provider|--model'
  --provider <name>
  --model <pattern>
  --system-prompt <text>
  --print, -p
  --no-session
  --no-tools
  --no-extensions, -ne
  --no-skills, -ns
  --no-prompt-templates, -np
```

#### Learnings

- Record the final executable-resolution approach for invoking `pi -p` in `.ai/current-work.md` once implemented so later maintenance does not re-open the subprocess contract question.

### Phase 2.2 — Integrate classifier into guardrails bash flow and session approvals

| Task | Description | Done |
|------|-------------|------|
| 2.2.1 | Update `extensions/guardrails/session-allow-list.ts` and `extensions/guardrails/session-allow-list.test.ts` so classifier session approvals use the exact full command under `("classifier_flagged", <full command>)`. Keep the existing exact-match storage model; add explicit helpers if needed so classifier approvals do not rely on ambiguous `rememberCommand()` metadata alone. | |
| 2.2.2 | Update `extensions/guardrails/index.ts` so the classifier runs only after deterministic bash checks have passed and only when: guardrails are enabled, `ctx.hasUI === true`, `classifier.enabled === true`, and no existing classifier session approval exists for the full command. The deterministic paths for hard-deny, rule-based violations, no-UI blocking, and runtime disable must remain unchanged. | |
| 2.2.3 | In `extensions/guardrails/index.ts`, when the classifier result risk meets or exceeds `promptThreshold`, surface a classifier-specific prompt using the existing bash confirmation UI path with a synthetic `classifier_flagged` violation. Reuse allow once / allow session / deny behavior, and emit distinct classifier event actions (`classifier-approved-once`, `classifier-approved-session`, `classifier-denied`, `classifier-timed-out`). | |
| 2.2.4 | Update `extensions/guardrails/confirmation-ui.ts` so `describeBashViolation()` renders classifier explanations cleanly and distinguishes classifier findings from deterministic violations without regressing the existing full-command display. | |
| 2.2.5 | Expand `extensions/guardrails/index.test.ts` to cover: classifier skipped when deterministic violations exist; classifier skipped when disabled; classifier skipped in headless mode; classifier prompt displayed on `high` or `medium` risk according to threshold; allow-session prevents re-classification of the exact same command; malformed/timeout/error classifier results fail open; and classifier-specific events are emitted with stable action values. Mock `./classifier.js` in integration tests instead of spawning the real CLI. | |

#### Review Gate

- `checkBash()` output is unchanged apart from the additive `classifier_flagged` type used only in the integration layer.
- The classifier is never invoked for commands already blocked or prompted by deterministic checks.
- Headless mode and `--no-guardrails` / `PI_NO_GUARDRAILS=1` still bypass classifier execution entirely.
- Session-scoped classifier approvals are exact full-command matches and do not suppress other violation types.
- Classifier-specific event actions are emitted from the same centralized allow/block paths used by the rest of guardrails.

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Session approval + bash integration tests | `0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/session-allow-list.test.ts extensions/guardrails/index.test.ts` |
| Classifier unit tests still pass after integration | `0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/classifier.test.ts` |

Expected outputs:

**Session approval + bash integration tests**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/session-allow-list.test.ts extensions/guardrails/index.test.ts
bun test v1.3.10
...
0 fail
```

**Classifier unit tests still pass after integration**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/classifier.test.ts
bun test v1.3.10
...
0 fail
```

#### Learnings

- If the integration needs a small helper to build the synthetic classifier violation or event payloads, record the helper path/name in `.ai/current-work.md` so future follow-up work reuses the same seam.

### Phase 2.3 — Surface classifier status, update docs/current-work, and run final regression gates

| Task | Description | Done |
|------|-------------|------|
| 2.3.1 | Update `extensions/guardrails/index.ts` so `session_start` and `/guardrails` display classifier status when configured: enabled/disabled, model, timeout, and threshold. Keep the Phase 1 runtime-disable output intact. | |
| 2.3.2 | Update `extensions/GUARDRAILS_QUICK_START.md` with the classifier config block, subprocess behavior, fail-open semantics, and the fact that the classifier is additive and opt-in. Keep examples aligned with the implemented schema and event behavior. | |
| 2.3.3 | Update `.ai/current-work.md` after implementation/testing to capture the Phase 2 implementation order, the final `pi -p` invocation approach, test commands/results, and the next deferred items under the same slug. | |
| 2.3.4 | Run the full guardrails regression suite and do a final code-review pass focused on Phase 1 regression risk, classifier fail-open correctness, prompt contents, and subprocess isolation flags. | |

#### Review Gate

- `/guardrails` and the session-start notification accurately describe classifier state without implying the classifier is mandatory.
- Docs match the implemented config schema and explicitly state that classifier failures fall back to Phase 1 behavior.
- `.ai/current-work.md` is updated with exact commands/results and restart guidance under the same slug.
- Final review confirms no reopened Phase 1 regressions and no recursion risk from the subprocess invocation.

#### Eval Gate

| What | Target | Command |
|------|--------|---------|
| Full guardrails regression suite | `0 fail` | `cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/*.test.ts` |
| Final CLI contract spot-check | Required flags still present | `cd /Users/matthias.eck/.pi/agent && pi --help 2>&1 | grep -E -- '--print, -p|--no-extensions|--no-tools|--no-session'` |

Expected outputs:

**Full guardrails regression suite**
```text
$ cd /Users/matthias.eck/.pi/agent && bun test extensions/guardrails/*.test.ts
bun test v1.3.10
...
0 fail
```

**Final CLI contract spot-check**
```text
$ cd /Users/matthias.eck/.pi/agent && pi --help 2>&1 | grep -E -- '--print, -p|--no-extensions|--no-tools|--no-session'
  --print, -p
  --no-session
  --no-tools
  --no-extensions, -ne
```

## Affected Files

### Phase 2 code changes
- `extensions/guardrails/classifier.ts` — new classifier subprocess module for prompt building, spawn/timeout handling, and response parsing
- `extensions/guardrails/classifier.test.ts` — new unit tests for prompt construction, subprocess args, parsing, and fail-open behavior
- `extensions/guardrails/index.ts` — additive classifier orchestration, prompt gating, session-start status, `/guardrails` status, and classifier event actions
- `extensions/guardrails/index.test.ts` — integration coverage for classifier flow and skip paths
- `extensions/guardrails/config.ts` — classifier config validation, defaults, and merge behavior
- `extensions/guardrails/config.test.ts` — config validation/merge regression tests for classifier settings
- `extensions/guardrails/types.ts` — classifier config/result/context types, violation union updates, and event action updates
- `extensions/guardrails/session-allow-list.ts` — exact full-command classifier session approvals
- `extensions/guardrails/session-allow-list.test.ts` — approval-store tests for classifier-specific approvals
- `extensions/guardrails/confirmation-ui.ts` — classifier explanation rendering within the existing bash confirmation UI
- `extensions/GUARDRAILS_QUICK_START.md` — classifier documentation and config examples
- `.ai/current-work.md` — synced Phase 2 implementation notes, eval results, and restart state

### Phase 1 baseline files that must not regress
- `extensions/guardrails/bash-guard.ts`
- `extensions/guardrails/path-guard.ts`
- `extensions/guardrails/shell-ast.ts`
- `extensions/guardrails/effective-cwd.ts`
- `extensions/guardrails/test-utils.ts`

## Test Strategy

- Keep Phase 2 automated coverage in Bun tests; do not depend on a live model or networked classifier during CI/local regression runs.
- Unit-test `extensions/guardrails/classifier.ts` with mocked subprocess execution so prompt construction, argument lists, parsing, timeout handling, and fail-open behavior are deterministic.
- Mock `./classifier.js` in `extensions/guardrails/index.test.ts` so integration tests verify guardrails control flow without invoking the real CLI.
- Retain the Phase 1 full regression suite as the final acceptance gate; all existing deterministic checks must continue passing unchanged.
- Use targeted suites during development (`config`, `classifier`, `session-allow-list`, `index`) and finish with `bun test extensions/guardrails/*.test.ts`.
- Treat `pi --help` grep checks as a lightweight contract test for the CLI flags the plan assumes.

## Deferred / Follow-up (Beyond Phase 2)

- `onlyIfExists` for deny patterns
- Named rule IDs / override semantics
- Semantic caching of classifier results across similar commands
- Heuristic pre-filtering before LLM classification
- Classifier analysis of commands that already have deterministic violations
- Interactive `/guardrails` config editing

## Risks & Assumptions

- **Assumption:** `pi --help` on 2026-04-06 confirms the required CLI flags exist for the approved subprocess contract: `-p`, `--system-prompt`, `--provider`, `--model`, `--no-tools`, `--no-extensions`, `--no-session`, `--no-skills`, and `--no-prompt-templates`.
- **Assumption:** The extension runtime can resolve the `pi` executable either directly from PATH or via a small runtime-derived fallback helper; this is an implementation detail, not a blocker, as long as the resolution logic is isolated and testable.
- **Assumption:** The classifier call will use plain text stdout capture only; no `--mode json` or RPC mode is needed.
- **Assumption:** Because the subprocess passes `--no-extensions` and no explicit `-e` flags, the classifier invocation will not recursively load the Guardrails extension.
- **Assumption:** `classifier.model` will be split on the first `/`, with the prefix used as `--provider` and the remainder used as `--model`.
- **Risk:** `index.ts` could accrete too much Phase 2 branching. Mitigation: keep subprocess/prompt/parsing logic inside `classifier.ts` and add small helpers for synthetic violations/events if needed.
- **Risk:** Fail-open handling could accidentally suppress logging or session approval behavior. Mitigation: cover timeout, subprocess error, malformed JSON, and invalid `risk` cases in both unit and integration tests.
- **Risk:** Status/UI strings can drift from config behavior. Mitigation: add direct assertions in `index.test.ts` for `session_start` and `/guardrails` output.
- **Risk:** A future Pi CLI change could alter flags. Mitigation: keep the help-output spot-check in the execution plan and record the actual invocation used in `.ai/current-work.md`.

## Open Questions

None. Phase 2 scope and behavior are fixed; the remaining `pi -p` executable-resolution detail is recorded as an implementation assumption rather than a blocker.

## References

- `.ai/current-work.md`
- `.ai/guardrails-permission-redesign-spec.md`
- `.ai/guardrails-permission-redesign-plan.md`
- `extensions/guardrails/index.ts`
- `extensions/guardrails/config.ts`
- `extensions/guardrails/types.ts`
- `extensions/guardrails/session-allow-list.ts`
- `extensions/guardrails/confirmation-ui.ts`
- `extensions/GUARDRAILS_QUICK_START.md`
- `pi --help`
- `/Users/matthias.eck/.cache/.bun/install/global/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
