---
goal: Replace the flat `.ai` archive markdown/file sprawl with a folder-based archive and keep top-level `.ai` limited to current work and long-term memory
author: Pi
date_created: 2026-03-26
last_updated: 2026-03-26
status: Completed
tags: [process, workflow, archive, markdown, cleanup]
---

# Plan

Implementation completed on 2026-03-26.

## Goals
- Replace `.ai/archive.md` with `.ai/archive/`.
- Move completed top-level `.ai` artifacts into `.ai/archive/` with dated filename prefixes.
- Keep top-level `.ai` limited to `current-work.md`, the `archive/` folder, and any future long-term memory files.
- Update active workflow docs so future completions are archived into files under `.ai/archive/` instead of appended to a rolling markdown log.

## Steps
1. ✅ Update `AGENTS.md`, active prompts, `.beads/PRIME.md`, and `.ai/current-work.md` to use folder-based archiving.
2. ✅ Create `.ai/archive/`.
3. ✅ Move completed top-level `.ai/*.md` artifacts into `.ai/archive/` with dated prefixes.
4. ✅ Update references to moved artifacts where active docs still point to them.
5. ✅ Run static checks and a review pass.

## Assumptions
- Because you said top-level `.ai` should contain only long-term memories or current work, all completed top-level `.ai/*.md` artifacts were archived, not only the ones that already had dates in their names.
- Files without a clear date in their filenames used `date_created` when available, otherwise the first ISO date found in the file, otherwise the file modification date.
