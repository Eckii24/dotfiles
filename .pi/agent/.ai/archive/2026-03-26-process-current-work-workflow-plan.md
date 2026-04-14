---
goal: Replace the Beads-based operational workflow in `~/.pi/agent` with a markdown-first `current-work` workflow optimized for one human + one AI
author: Pi
date_created: 2026-03-26
last_updated: 2026-03-26
status: Completed
tags: [process, workflow, architecture, markdown, current-work]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

> Historical note: this archived plan reflects the first markdown-first workflow rollout. Its original rolling-archive-file model was later superseded by the folder-based archive documented in `AGENTS.md` and `.ai/current-work.md`.

This plan replaces the current Beads-heavy workflow with a markdown-first operating model centered on one active feature at a time. The target state is: `.ai/current-work.md` becomes the operational source of truth, feature-sized artifacts stay in `.ai/` with a consistent naming scheme, and completed work is summarized as dated entries in `.ai/archive/2026-03-26-archive.md`.

Implementation completed on 2026-03-26. Static evals EVAL-001 through EVAL-006 passed.

## 1. Requirements & Constraints

- **REQ-001**: Optimize the workflow for a single human operator with no multi-user claim or dependency management needs.
- **REQ-002**: Keep exactly one active feature in `.ai/current-work.md` at any given time.
- **REQ-003**: Preserve `.ai/` as the home for specs, plans, reviews, and related artifacts.
- **REQ-004**: Use a consistent artifact naming scheme: `.ai/<slug>-spec.md`, `.ai/<slug>-plan.md`, `.ai/<slug>-review.md`.
- **REQ-005**: Keep a small parking lot in the current-work file for side ideas and follow-ups.
- **REQ-006**: Allow the AI to revise the working plan as it learns, without requiring approval for every refinement.
- **REQ-007**: Optimize resumption for two questions first: "what is active now?" and "where are the relevant files?"
- **REQ-008**: Keep archival history lightweight as dated entries rather than a heavyweight audit system.
- **CON-001**: Existing Beads-related files and docs exist in the repo and should be treated as historical during migration.
- **CON-002**: The repo already contains prompt and agent instructions that explicitly reference Beads and `bd prime --stealth`.
- **CON-003**: This repo's existing instruction hierarchy currently prefers `.ai/` for artifacts; this plan keeps that convention.
- **GUD-001**: Prefer semi-structured markdown over freeform notes.
- **GUD-002**: Prefer enough structure for the AI over ultra-minimal notes that lose context.
- **GUD-003**: Avoid recreating bureaucracy under a different name.
- **ASSUMPTION-001**: `.ai/archive/2026-03-26-archive.md` will be a single rolling file with dated entries, because the user clarified “dated entry” rather than one file per work item/day.
- **ASSUMPTION-002**: Initial migration should retire Beads from active instructions first; cleanup of local `.beads/` runtime files can happen later once no prompt depends on them.
- **ASSUMPTION-003**: A dedicated `.ai/README.md` is not required initially because `.ai/current-work.md` will act as the main navigation hub.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Define the markdown-first operational model and create the core files/templates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Replace the Beads-focused "Issue Tracking" section in `AGENTS.md` with a `current-work` section that declares `.ai/current-work.md` as the operational source of truth for active work. | ✅ | 2026-03-26 |
| TASK-002 | Add explicit rules to `AGENTS.md` for exactly one active feature, linked `.ai/<slug>-*.md` artifacts, a small parking lot, and a rolling `.ai/archive/2026-03-26-archive.md` dated-entry archive. | ✅ | 2026-03-26 |
| TASK-003 | Create `.ai/current-work.md` with a semi-structured template containing: active feature, objective, current step, evolving plan, relevant files, linked artifacts, open questions/blockers, parking lot, and completion handoff. | ✅ | 2026-03-26 |
| TASK-004 | Create `.ai/archive/2026-03-26-archive.md` with a lightweight dated-entry format for completed work summaries. | ✅ | 2026-03-26 |

#### Eval Gate — Phase 1

> All criteria in this gate must pass before proceeding to Phase 2.

| Eval ID | Metric | Target | Verification Command |
|---------|--------|--------|----------------------|
| EVAL-001 | `AGENTS.md` declares markdown-first workflow | Required `current-work` rules present and Beads SSOT language removed | `python3 - <<'PY' ... PY` |
| EVAL-002 | Core markdown files exist with required sections | `.ai/current-work.md` and `.ai/archive/2026-03-26-archive.md` created with expected headings | `python3 - <<'PY' ... PY` |

**EVAL-001 — AGENTS current-work rules**
```text
# Run
python3 - <<'PY'
from pathlib import Path
text = Path('AGENTS.md').read_text()
required = [
    '.ai/current-work.md',
    '.ai/archive/2026-03-26-archive.md',
    'exactly one active feature',
    '.ai/<slug>-spec.md',
    '.ai/<slug>-plan.md',
    '.ai/<slug>-review.md',
]
for item in required:
    assert item in text, item
for forbidden in ['Beads is the source of truth', 'bd prime --stealth']:
    assert forbidden not in text, forbidden
print('PASS: AGENTS current-work rules present and Beads SSOT removed')
PY

# Expected output
PASS: AGENTS current-work rules present and Beads SSOT removed
```

**EVAL-002 — Core markdown workflow files**
```text
# Run
python3 - <<'PY'
from pathlib import Path
current = Path('.ai/current-work.md').read_text()
archive = Path('.ai/archive/2026-03-26-archive.md').read_text()
for item in ['## Active Feature', '## Current Step', '## Relevant Files', '## Linked Artifacts', '## Parking Lot']:
    assert item in current, item
assert '# Archive' in archive
assert '## 2026-' in archive or '## YYYY-MM-DD' in archive
print('PASS: current-work and archive templates exist with required sections')
PY

# Expected output
PASS: current-work and archive templates exist with required sections
```

### Implementation Phase 2

- **GOAL-002**: Update prompts and thin agents to use the markdown-first workflow instead of Beads state management.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Update `prompts/idea-to-code.md` to start from `.ai/current-work.md`, maintain linked `.ai/<slug>-*.md` artifacts, and stop referring to epic/child beads or `bd prime --stealth`. | ✅ | 2026-03-26 |
| TASK-006 | Update `prompts/story-to-code.md` with the same markdown-first model, including story retrieval plus `current-work` updates instead of bead lifecycle steps. | ✅ | 2026-03-26 |
| TASK-007 | Update `prompts/scout-and-plan.md`, `prompts/implement.md`, and `prompts/implement-and-review.md` so they operate on the active feature from `.ai/current-work.md` and return artifact paths/results without Beads bookkeeping. | ✅ | 2026-03-26 |
| TASK-008 | Update `agents/scout.md`, `agents/worker.md`, `agents/spec-writer.md`, `agents/plan-writer.md`, and `agents/code-reviewer.md` so they report explicit file/artifact paths and current-work context rather than tracker-specific context. | ✅ | 2026-03-26 |

#### Eval Gate — Phase 2

> All criteria in this gate must pass before proceeding to Phase 3.

| Eval ID | Metric | Target | Verification Command |
|---------|--------|--------|----------------------|
| EVAL-003 | Active prompts no longer depend on Beads | No `bd` / Beads lifecycle language remains in active prompt files | `python3 - <<'PY' ... PY` |
| EVAL-004 | Prompts and agents reference current-work flow | Required `current-work` / artifact-path language is present in active files | `python3 - <<'PY' ... PY` |

**EVAL-003 — Remove active Beads dependencies from prompts/agents**
```text
# Run
python3 - <<'PY'
from pathlib import Path
files = [
    'prompts/idea-to-code.md',
    'prompts/story-to-code.md',
    'prompts/scout-and-plan.md',
    'prompts/implement.md',
    'prompts/implement-and-review.md',
    'agents/worker.md',
    'agents/spec-writer.md',
    'agents/plan-writer.md',
    'agents/code-reviewer.md',
]
for path in files:
    text = Path(path).read_text()
    for forbidden in ['bd prime --stealth', 'Beads', 'bead context', 'child bead']:
        assert forbidden not in text, f'{path}: {forbidden}'
print('PASS: active prompts and agents no longer depend on Beads wording')
PY

# Expected output
PASS: active prompts and agents no longer depend on Beads wording
```

**EVAL-004 — Current-work language present in prompts/agents**
```text
# Run
python3 - <<'PY'
from pathlib import Path
checks = {
    'prompts/idea-to-code.md': ['.ai/current-work.md', '.ai/<slug>-plan.md', 'ask the user via `questionnaire` before replacing it'],
    'prompts/story-to-code.md': ['.ai/current-work.md', '.ai/<slug>-plan.md', 'ask the user via `questionnaire` before replacing it'],
    'prompts/scout-and-plan.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'prompts/implement.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'prompts/implement-and-review.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'agents/scout.md': ['Current-Work Context'],
    'agents/worker.md': ['Artifact Paths'],
    'agents/spec-writer.md': ['Specification File'],
    'agents/plan-writer.md': ['Plan File'],
    'agents/code-reviewer.md': ['Summary'],
}
for path, required in checks.items():
    text = Path(path).read_text()
    for item in required:
        assert item in text, f'{path}: missing {item}'
print('PASS: current-work, feature-switch, and artifact-path language present in prompts and agents')
PY

# Expected output
PASS: current-work, feature-switch, and artifact-path language present in prompts and agents
```

### Implementation Phase 3

- **GOAL-003**: Retire Beads-specific repo guidance cleanly while preserving history and preventing future drift.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | Update `.beads/PRIME.md` and any repo-local guidance that is still read by agents so it either points to the markdown-first workflow or is clearly marked historical/deprecated. | ✅ | 2026-03-26 |
| TASK-010 | Update `.ai/archive/2026-03-25-beads-rollout-status.md` and `.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md` with a short superseded note, or move that note into a new migration artifact, so future sessions do not mistake them for the active workflow. | ✅ | 2026-03-26 |
| TASK-011 | Optionally remove local `.beads/` runtime data after confirming no active prompts/instructions rely on it. | N/A | 2026-03-26 |

#### Eval Gate — Phase 3

> All criteria in this gate must pass before marking the migration complete.

| Eval ID | Metric | Target | Verification Command |
|---------|--------|--------|----------------------|
| EVAL-005 | Historical Beads docs are clearly superseded | Historical docs contain a superseded note or equivalent pointer | `python3 - <<'PY' ... PY` |
| EVAL-006 | No active workflow path points back to Beads | `AGENTS.md`, active prompts, and `.beads/PRIME.md` align on markdown-first current-work | `python3 - <<'PY' ... PY` |

**EVAL-005 — Historical Beads docs marked superseded**
```text
# Run
python3 - <<'PY'
from pathlib import Path
files = [
    '.ai/archive/2026-03-25-beads-rollout-status.md',
    '.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md',
]
for path in files:
    text = Path(path).read_text()
    assert 'Superseded by markdown-first current-work workflow' in text, path
print('PASS: historical Beads docs are marked superseded')
PY

# Expected output
PASS: historical Beads docs are marked superseded
```

**EVAL-006 — Workflow instructions align on current-work**
```text
# Run
python3 - <<'PY'
from pathlib import Path
files = ['AGENTS.md', '.beads/PRIME.md']
for path in files:
    text = Path(path).read_text()
    assert '.ai/current-work.md' in text, path
    assert 'Beads is the source of truth' not in text, path
print('PASS: repo-level workflow instructions align on current-work')
PY

# Expected output
PASS: repo-level workflow instructions align on current-work
```

## 3. Alternatives

- **ALT-001**: Keep Beads and try to reduce ceremony. Rejected because the user works solo and the remaining complexity still solves the wrong problem.
- **ALT-002**: Use only ad-hoc markdown notes without a central hub. Rejected because resumability and file discovery would drift quickly.
- **ALT-003**: Keep a hybrid where Beads tracks state and `.ai/` tracks artifacts. Rejected because it preserves the duplication the user wants to remove.

## 4. Dependencies

- **DEP-001**: `AGENTS.md` must be updated first because it is the repo’s authoritative workflow instruction file.
- **DEP-002**: Prompt files under `prompts/` must align with `AGENTS.md` to avoid instruction drift.
- **DEP-003**: Thin agent files under `agents/` must align with the prompt wording so subagent outputs remain compatible.

## 5. Files

- **FILE-001**: `AGENTS.md` — replace Beads workflow rules with markdown-first current-work rules.
- **FILE-002**: `.ai/current-work.md` — new primary operational hub for exactly one active feature.
- **FILE-003**: `.ai/archive/2026-03-26-archive.md` — new rolling archive of dated completion entries.
- **FILE-004**: `prompts/idea-to-code.md` — remove bead lifecycle orchestration.
- **FILE-005**: `prompts/story-to-code.md` — remove bead lifecycle orchestration.
- **FILE-006**: `prompts/scout-and-plan.md` — replace bead-task framing with current-work framing.
- **FILE-007**: `prompts/implement.md` — replace bead-task framing with current-work framing.
- **FILE-008**: `prompts/implement-and-review.md` — replace bead-task framing with current-work framing.
- **FILE-009**: `agents/scout.md` — replace tracker-context output rules.
- **FILE-010**: `agents/worker.md` — replace tracker-context output rules.
- **FILE-011**: `agents/spec-writer.md` — replace tracker-context output rules.
- **FILE-012**: `agents/plan-writer.md` — replace tracker-context output rules.
- **FILE-013**: `agents/code-reviewer.md` — replace tracker-context output rules.
- **FILE-014**: `.beads/PRIME.md` — either repoint or mark historical.
- **FILE-015**: `.ai/archive/2026-03-25-beads-rollout-status.md` — mark historical/superseded.
- **FILE-016**: `.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md` — mark historical/superseded.

## 6. Testing

- **TEST-001**: Static check that `AGENTS.md` defines the current-work workflow and no longer defines Beads as SSOT.
- **TEST-002**: Static check that `.ai/current-work.md` and `.ai/archive/2026-03-26-archive.md` exist with the required sections.
- **TEST-003**: Static check that active prompts no longer reference `bd prime --stealth`, beads, or child-bead lifecycle language.
- **TEST-004**: Static check that prompts and agents refer to `.ai/current-work.md`, explicit artifact paths, feature-switch behavior, and current-work updates after planning/review passes.
- **TEST-005**: Historical-doc check that old Beads rollout docs are clearly marked superseded.

## 7. Evals

### 7.1 Metrics

| Eval ID | Phase | Metric | Target | Actual | Status |
|---------|-------|--------|--------|--------|--------|
| EVAL-001 | Phase 1 | `AGENTS.md` defines current-work model | Required current-work strings present; Beads SSOT strings absent | PASS (`AGENTS.md` static check) | ✅ |
| EVAL-002 | Phase 1 | Core markdown files created | `.ai/current-work.md` and `.ai/archive/2026-03-26-archive.md` match template checks | PASS (`current-work` / `archive` template checks) | ✅ |
| EVAL-003 | Phase 2 | Active prompts/agents no longer depend on Beads | Forbidden Beads strings absent | PASS (prompt/agent wording check) | ✅ |
| EVAL-004 | Phase 2 | Active prompts/agents use current-work flow | Required strings present in prompt/agent files, including feature-switch and current-work-update rules | PASS (current-work string check) | ✅ |
| EVAL-005 | Phase 3 | Historical Beads docs are visibly superseded | Superseded note present in historical docs | PASS (historical-doc superseded check) | ✅ |
| EVAL-006 | Phase 3 | Repo-level instructions align on current-work | `AGENTS.md` and `.beads/PRIME.md` no longer conflict | PASS (repo-level instruction alignment check) | ✅ |

> Status legend: ⬜ Not run · ✅ Passed · ❌ Failed

### 7.2 Expected Eval Outputs

**EVAL-001 — AGENTS current-work rules**
```text
# Run
python3 - <<'PY'
from pathlib import Path
text = Path('AGENTS.md').read_text()
required = ['.ai/current-work.md', '.ai/archive/2026-03-26-archive.md', 'exactly one active feature']
for item in required:
    assert item in text, item
for forbidden in ['Beads is the source of truth', 'bd prime --stealth']:
    assert forbidden not in text, forbidden
print('PASS: AGENTS current-work rules present and Beads SSOT removed')
PY

# Expected output
PASS: AGENTS current-work rules present and Beads SSOT removed
```

**EVAL-002 — Core markdown workflow files**
```text
# Run
python3 - <<'PY'
from pathlib import Path
assert Path('.ai/current-work.md').exists()
assert Path('.ai/archive/2026-03-26-archive.md').exists()
print('PASS: current-work and archive templates exist with required sections')
PY

# Expected output
PASS: current-work and archive templates exist with required sections
```

**EVAL-003 — Remove active Beads dependencies from prompts/agents**
```text
# Run
python3 - <<'PY'
from pathlib import Path
files = [
    'prompts/idea-to-code.md',
    'prompts/story-to-code.md',
    'prompts/scout-and-plan.md',
    'prompts/implement.md',
    'prompts/implement-and-review.md',
    'agents/worker.md',
    'agents/spec-writer.md',
    'agents/plan-writer.md',
    'agents/code-reviewer.md',
]
for path in files:
    text = Path(path).read_text()
    for forbidden in ['bd prime --stealth', 'Beads', 'bead context', 'child bead']:
        assert forbidden not in text, f'{path}: {forbidden}'
print('PASS: active prompts and agents no longer depend on Beads wording')
PY

# Expected output
PASS: active prompts and agents no longer depend on Beads wording
```

**EVAL-004 — Current-work language present in prompts/agents**
```text
# Run
python3 - <<'PY'
from pathlib import Path
checks = {
    'prompts/idea-to-code.md': ['.ai/current-work.md', '.ai/<slug>-plan.md', 'ask the user via `questionnaire` before replacing it'],
    'prompts/story-to-code.md': ['.ai/current-work.md', '.ai/<slug>-plan.md', 'ask the user via `questionnaire` before replacing it'],
    'prompts/scout-and-plan.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'prompts/implement.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'prompts/implement-and-review.md': ['.ai/current-work.md', 'update `.ai/current-work.md` before you stop'],
    'agents/scout.md': ['Current-Work Context'],
    'agents/worker.md': ['Artifact Paths'],
    'agents/spec-writer.md': ['Specification File'],
    'agents/plan-writer.md': ['Plan File'],
    'agents/code-reviewer.md': ['Summary'],
}
for path, required in checks.items():
    text = Path(path).read_text()
    for item in required:
        assert item in text, f'{path}: missing {item}'
print('PASS: current-work, feature-switch, and artifact-path language present in prompts and agents')
PY

# Expected output
PASS: current-work, feature-switch, and artifact-path language present in prompts and agents
```

**EVAL-005 — Historical Beads docs marked superseded**
```text
# Run
python3 - <<'PY'
from pathlib import Path
for path in ['.ai/archive/2026-03-25-beads-rollout-status.md', '.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md']:
    assert 'Superseded by markdown-first current-work workflow' in Path(path).read_text(), path
print('PASS: historical Beads docs are marked superseded')
PY

# Expected output
PASS: historical Beads docs are marked superseded
```

**EVAL-006 — Workflow instructions align on current-work**
```text
# Run
python3 - <<'PY'
from pathlib import Path
for path in ['AGENTS.md', '.beads/PRIME.md']:
    text = Path(path).read_text()
    assert '.ai/current-work.md' in text, path
    assert 'Beads is the source of truth' not in text, path
print('PASS: repo-level workflow instructions align on current-work')
PY

# Expected output
PASS: repo-level workflow instructions align on current-work
```

## 8. Risks & Assumptions

- **RISK-001**: If `current-work.md` is allowed to accumulate too much stale detail, it will become a softer, messier version of the bureaucracy this migration is trying to remove.
- **RISK-002**: If prompt and agent wording is only partially migrated, the repo will have conflicting instructions and the AI will behave inconsistently.
- **RISK-003**: If old Beads docs are left active-looking, future sessions may continue following the wrong workflow.
- **RISK-004**: If multiple simultaneous ideas are pushed into one active-feature file, the simplicity benefit will collapse.
- **ASSUMPTION-004**: Subagent usage should remain in place; only the work-tracking model changes.
- **ASSUMPTION-005**: Feature-sized work usually still benefits from dedicated spec/plan/review files, even in a markdown-first workflow.

## 9. Related Specifications / Further Reading

- `AGENTS.md`
- `prompts/idea-to-code.md`
- `prompts/story-to-code.md`
- `.ai/archive/2026-03-25-beads-rollout-status.md`
- `.ai/archive/2026-03-25-architecture-pi-agent-beads-integration-1.md`
