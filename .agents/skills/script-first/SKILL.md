---
name: script-first
description: Collapses deterministic multi-step repository research, aggregation, indexing, validation, and transformation into one small purpose-built local script and one Bash run. Use when a task would otherwise require 6+ related read/search/tool calls, iterates over many files or records, cross-references results, or requests batch analysis; do not use for small exploration or broad mutations.
---

# Script-first

For deterministic multi-step work, prefer one purpose-built script in one Bash run over a model -> tool -> model chain.

## Use when

- 6+ related read/search calls are likely.
- Iterating over files, records, URLs, or command output.
- Aggregating, indexing, validating, extracting, or cross-referencing known data.
- The desired result and output shape are clear before execution.

Examples: TODO inventory, symbol index, test/config coverage report, cross-file consistency check, batch metadata extraction.

## Do not use when

- A single file or `grep -> read -> done` is enough.
- The next action materially depends on interpreting an unknown result.
- The work makes broad, irreversible, external, or user-visible changes.
- A human decision or confirmation is required between steps.

Do not manufacture a script merely to satisfy this skill.

## Procedure

1. State the narrow question and bounded input scope.
2. Write one small script, usually Python with stdlib plus `subprocess` for local CLI tools.
3. In that script: discover inputs, read/process them, aggregate, and print only the requested result.
4. Run it through one Bash invocation. Prefer a quoted heredoc or `mktemp` script under `/tmp`; do not leave artifacts unless they are useful deliverables.
5. Handle expected per-input failures and report compact partial results.
6. Inspect the result. Run a second script only if the first result exposes a real new question.

## Boundaries

- Default to read-only. Keep writes explicit, narrowly scoped, and separately justified.
- Do not use the script to bypass Pi guardrails, path policy, confirmation, or secret restrictions.
- Do not read credentials, auth files, `.env` files, or unrelated home directories.
- Do not download or execute remote code.
- Keep output under roughly 5 KB: counts, summaries, selected findings, and truncation notices. Never dump full file contents or unfiltered large lists.
- Use deterministic ordering and include paths/line numbers where useful.

## Good shape

```bash
python3 - <<'PY'
from pathlib import Path

hits = []
for path in sorted(Path("src").rglob("*.py")):
    try:
        for number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            if "TODO" in line:
                hits.append(f"{path}:{number}: {line.strip()}")
    except OSError as error:
        print(f"WARN {path}: {error}")

print(f"TODOs: {len(hits)}")
print("\n".join(hits[:100]))
if len(hits) > 100:
    print(f"... truncated {len(hits) - 100} more")
PY
```

One Bash call. Script performs discovery, processing, and reduction. Model interprets compact result afterward.
