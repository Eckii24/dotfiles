# Skill Quality Checklist

Read before finalizing a new or materially revised skill.

## Routing

- [ ] `name` matches directory and uses lowercase kebab-case.
- [ ] Description states capability, concrete trigger intents, and material near misses.
- [ ] Two to three trigger requests would select this skill from description alone.
- [ ] Two to three near misses select an identified alternative instead.
- [ ] The skill is justified by recurring work, correction, failure, or reusable knowledge — not novelty.

## Main contract

- [ ] Main file contains only the normal path, invariants, safety boundaries, required resources, validation, and failure handling.
- [ ] Every instruction changes execution; duplicated rationale and generic advice are removed.
- [ ] It names explicit ownership boundaries when adjacent skills or tools are involved.
- [ ] It does not claim unavailable tools, interpolation, model behavior, or runtime features.

## Resources

- [ ] Rare detail is in `references/`; reusable shapes are in `assets/`; deterministic mechanics are in `scripts/`.
- [ ] Common execution is complete without opening optional references.
- [ ] Every resource pointer is exact, exists, and names when to read/use/run it.
- [ ] References are one level deep; no stale links or empty resource directories remain.
- [ ] Scripts support `--help`, safe/idempotent defaults, bounded output, clear exit codes, and confirmation or dry-run for destructive behavior.

## Evidence

- [ ] All links, commands, paths, schemas, and version-sensitive guidance were checked against the active environment.
- [ ] One representative safe execution passed, or the skipped proof and reason are recorded.
- [ ] Routing results for trigger and near-miss cases are recorded.
- [ ] An independent review was used when proportionate; otherwise its absence is explicit.
- [ ] Only evidence-backed corrections were retained.
