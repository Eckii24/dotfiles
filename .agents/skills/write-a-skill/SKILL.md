---
name: write-a-skill
description: Create, revise, or retire a reusable agent skill with accurate routing, progressive disclosure, and verified resources. Use when authoring or materially changing a SKILL.md, its description, references, assets, scripts, or reusable workflow guidance. Do not use for one-off preferences, installing third-party skills, or a non-reusable task.
---

# Write a Skill

## Contract

- One coherent recurring job per skill. Ground it in real repeated work, corrections, failures, or durable domain knowledge.
- Keep activation guidance in frontmatter `description`; the body loads after activation.
- Preserve behavior outside the evidence-backed change. Do not collect skills speculatively.
- Read [`references/skill-quality-checklist.md`](references/skill-quality-checklist.md) before finalizing a new or material revision.

## Routing first

1. Record 2–3 realistic trigger requests: input, expected output, success criteria, constraints.
2. Record 2–3 near misses. Name the adjacent skill or direct workflow that owns each instead.
3. Draft description first: third-person capability, concrete triggers, and material non-triggers. Keep it compact.
4. Do not describe tool mechanics in frontmatter unless they distinguish routing.

## Progressive disclosure

Keep in `SKILL.md`:

- trigger-specific invariants and safety boundaries;
- the normal decision flow;
- mandatory resources and when to load or run them;
- verification and failure handling.

Move conditional detail deliberately:

| Resource | Use for |
|---|---|
| `references/` | long workflows, vendor/version details, schemas, examples, pitfalls |
| `assets/` | templates, starter artifacts, output shapes |
| `scripts/` | repeatable or fragile deterministic work |

Do not split merely to meet a line count. Split when the common case remains complete without the deferred material. References stay one level deep and every pointer names its read/use condition.

## Build and validate

1. Inspect target skill, nearby skills, runtime conventions, tools, and referenced resources.
2. Write the smallest actionable contract. Prefer short headings, bullets, and explicit boundaries over prose.
3. Add a script only when deterministic execution, error handling, or repeat reuse beats generated commands. Scripts need safe defaults, `--help`, bounded output, clear exits, and confirmation/dry-run for destructive actions.
4. Check every referenced path, command, example, and version-sensitive claim against the live environment.
5. Test routing with the recorded triggers and near misses from description alone.
6. Run one representative safe execution. Use an independent reviewer when proportionate; otherwise state the independence limit.
7. Report changed files, checks run/skipped, routing cases, and remaining risk.
