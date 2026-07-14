# Pi Agent Configuration Context

## Purpose

This repository configures the local Pi Agent runtime. It is managed by yadm; active settings are selected through yadm alternatives. Do not read or alter `auth.json` unless Matthias explicitly asks.

## Durable layers

| Layer | Purpose | Not for |
|---|---|---|
| `AGENTS.md` | compact operating rules and workflow surface | task history or orchestration policy |
| `CONTEXT.md` | durable domain language, component boundaries, and local conventions | temporary work state |
| `modes/*.md` | executable mode policy: optional model/tools/skills/thinking overrides plus system prompt | project/task-specific instructions |
| `docs/adr/` | rare, consequential, reversible-with-cost decisions | routine implementation choices |
| `.ai/` | active work, wayfinding, specs, implementation plans, reviews, and archives | universal project metadata |

## Modes

`extensions/modes/` discovers direct Markdown files in `modes/`. Only `command` is required. Omitted `model`, `tools`, `skills`, or `thinking` inherit the currently active Pi session value; explicitly set frontmatter overrides that one dimension. A bare model ID resolves through the active settings' `defaultProvider`; `provider/model` pins the provider; a quoted `@identifier` resolves from settings `modelTiers` before provider resolution. The body is appended as the active mode system prompt.

| Command | Lane | Model | Authority |
|---|---|---|---|
| `/quick` | direct small work | Luna | normal local tools; no workflow ceremony or subagents |
| `/work` | bounded delivery | Terra | normal local tools plus one bounded delegation when useful |
| `/orchestrate` | ambiguity and integration | Sol | read-only repo evidence plus `subagent`; no direct mutation or shell |

Modes persist in the Pi session. Switch lane/topic with a fresh session and compact handoff when the prior transcript would contaminate the task.

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
