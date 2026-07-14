# Pi Agent Configuration Context

## Purpose

This repository configures the local Pi Agent runtime. It is managed by yadm; active settings are selected through yadm alternatives. Do not read or alter `auth.json` unless Matthias explicitly asks.

## Durable layers

| Layer | Purpose | Not for |
|---|---|---|
| `AGENTS.md` | compact operating rules and workflow surface | task history or design rationale |
| `CONTEXT.md` | durable domain language, component boundaries, and local conventions | temporary work state |
| `docs/adr/` | rare, consequential, reversible-with-cost decisions | routine implementation choices |
| `.ai/` | active work, wayfinding, specs, implementation plans, reviews, and archives | universal project metadata |

## Workflow artifacts

Tracked local work uses `.ai/` as its source of truth:

```text
.ai/<slug>-wayfinder.md  # only for unclear, multi-decision initiatives
.ai/<slug>-spec.md       # bounded implementation contract
.ai/<slug>-plan.md       # architecture and file-level implementation plan
.ai/<slug>-review.md     # explicit formal-review evidence
.ai/current-work.md      # compact restart anchor only
```

No GitHub tracker is assumed or required.

## Project adoption rule

Target repositories may add their own `CONTEXT.md` and `docs/adr/` only when durable domain terms or hard architectural choices justify them. Do not create either artifact automatically for every task or small repository.
