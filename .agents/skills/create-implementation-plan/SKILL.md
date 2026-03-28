---
name: create-implementation-plan
description: 'Create a new implementation plan file for new features, refactoring existing code or upgrading packages, design, architecture or infrastructure.'
---

# Create Implementation Plan

## Primary Directive

Your goal is to create a new implementation plan file for `${input:PlanPurpose}`. Your output must be machine-readable, deterministic, and structured for autonomous execution by other AI systems or humans.

**Every plan MUST include evals.** Evals are not optional. Each implementation phase must contain an Eval Gate, and the plan must contain a dedicated Evals section (§7) with quantitative metrics and exact expected outputs that prove the implementation is correct and complete.

## Execution Context

This prompt is designed for AI-to-AI communication and automated processing. All instructions must be interpreted literally and executed systematically without human interpretation or clarification.

## Core Requirements

- Generate implementation plans that are fully executable by AI agents or humans
- Use deterministic language with zero ambiguity
- Structure all content for automated parsing and execution
- Ensure complete self-containment with no external dependencies for understanding
- **Always include Eval Gates per phase and a final Evals section — no exceptions**

## Plan Structure Requirements

Plans must consist of discrete, atomic phases containing executable tasks. Each phase must be independently processable by AI agents or humans without cross-phase dependencies unless explicitly declared.

## Phase Architecture

- Each phase must have measurable completion criteria
- Tasks within phases must be executable in parallel unless dependencies are specified
- All task descriptions must include specific file paths, function names, and exact implementation details
- No task should require human interpretation or decision-making
- **Each phase must end with an Eval Gate** — a table of metrics, the exact command to run, and the exact expected output that must be observed before proceeding to the next phase

## Eval Requirements

Evals serve as the definitive proof that an implementation is correct and complete. They are not aspirational — they are executable verification steps with exact expected outputs.

### Per-Phase Eval Gates

Every implementation phase must include an `#### Eval Gate` subsection containing:
- A metrics table with: Eval ID, metric description, target value, verification command
- Expected output blocks — exact terminal/log output that must match when the implementation is correct

### Final Evals Section (§7)

The plan must contain a standalone Evals section with:
- **Metrics table**: All EVAL-IDs across all phases, their targets, and a column for actual results (filled in during execution)
- **Expected eval outputs**: One block per critical metric showing the exact command and the exact output that proves success
- Coverage of all critical correctness, performance, and integration properties

### Eval Identifier Standard

All eval identifiers must use the prefix `EVAL-` followed by a zero-padded three-digit number (e.g., `EVAL-001`, `EVAL-002`). Eval IDs must be unique across the entire plan.

## AI-Optimized Implementation Standards

- Use explicit, unambiguous language with zero interpretation required
- Structure all content as machine-parseable formats (tables, lists, structured data)
- Include specific file paths, line numbers, and exact code references where applicable
- Define all variables, constants, and configuration values explicitly
- Provide complete context within each task description
- Use standardized prefixes for all identifiers (REQ-, TASK-, EVAL-, etc.)
- Include validation criteria that can be automatically verified

## Output File Specifications

- Save the implementation plan to the output path provided in the task. If no explicit path is provided, follow the `tracked-work` skill conventions.
- File must be valid Markdown with proper front matter structure

## Mandatory Template Structure

All implementation plans must strictly adhere to the following template. Each section is required and must be populated with specific, actionable content. AI agents must validate template compliance before execution.

## Template Validation Rules

- All front matter fields must be present and properly formatted
- All section headers must match exactly (case-sensitive)
- All identifier prefixes must follow the specified format
- Tables must include all required columns
- No placeholder text may remain in the final output
- Every implementation phase must contain an `#### Eval Gate` subsection
- Section §7 (Evals) must be present and fully populated

## Status

The status of the implementation plan must be clearly defined in the front matter and must reflect the current state of the plan. The status can be one of the following (status_color in brackets): `Completed` (bright green badge), `In progress` (yellow badge), `Planned` (blue badge), `Deprecated` (red badge), or `On Hold` (orange badge). It should also be displayed as a badge in the introduction section.

```md
---
goal: [Concise Title Describing the Package Implementation Plan's Goal]
version: [Optional: e.g., 1.0, Date]
date_created: [YYYY-MM-DD]
last_updated: [Optional: YYYY-MM-DD]
owner: [Optional: Team/Individual responsible for this spec]
status: 'Completed'|'In progress'|'Planned'|'Deprecated'|'On Hold'
tags: [Optional: List of relevant tags or categories, e.g., `feature`, `upgrade`, `chore`, `architecture`, `migration`, `bug` etc]
---

# Introduction

![Status: <status>](https://img.shields.io/badge/status-<status>-<status_color>)

[A short concise introduction to the plan and the goal it is intended to achieve.]

## 1. Requirements & Constraints

[Explicitly list all requirements & constraints that affect the plan and constrain how it is implemented. Use bullet points or tables for clarity.]

- **REQ-001**: Requirement 1
- **SEC-001**: Security Requirement 1
- **[3 LETTERS]-001**: Other Requirement 1
- **CON-001**: Constraint 1
- **GUD-001**: Guideline 1
- **PAT-001**: Pattern to follow 1

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: [Describe the goal of this phase, e.g., "Implement feature X", "Refactor module Y", etc.]

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Description of task 1 | ✅ | 2025-04-25 |
| TASK-002 | Description of task 2 | |  |
| TASK-003 | Description of task 3 | |  |

#### Eval Gate — Phase 1

> All criteria in this gate must pass before proceeding to Phase 2.

| Eval ID | Metric | Target | Verification Command |
|---------|--------|--------|----------------------|
| EVAL-001 | [e.g., Unit tests pass] | [e.g., 0 failures] | `[e.g., npm test]` |
| EVAL-002 | [e.g., Build succeeds] | [e.g., exit code 0] | `[e.g., npm run build]` |

**EVAL-001 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed to consider this eval passed]
```

**EVAL-002 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed to consider this eval passed]
```

### Implementation Phase 2

- GOAL-002: [Describe the goal of this phase, e.g., "Implement feature X", "Refactor module Y", etc.]

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Description of task 4 | |  |
| TASK-005 | Description of task 5 | |  |
| TASK-006 | Description of task 6 | |  |

#### Eval Gate — Phase 2

> All criteria in this gate must pass before proceeding to the next phase (or marking the implementation complete).

| Eval ID | Metric | Target | Verification Command |
|---------|--------|--------|----------------------|
| EVAL-003 | [e.g., Integration tests pass] | [e.g., 100% pass rate] | `[e.g., npm run test:integration]` |
| EVAL-004 | [e.g., Response time p95] | [e.g., < 200 ms] | `[e.g., npm run benchmark]` |

**EVAL-003 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed to consider this eval passed]
```

**EVAL-004 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed to consider this eval passed]
```

## 3. Alternatives

[A bullet point list of any alternative approaches that were considered and why they were not chosen. This helps to provide context and rationale for the chosen approach.]

- **ALT-001**: Alternative approach 1
- **ALT-002**: Alternative approach 2

## 4. Dependencies

[List any dependencies that need to be addressed, such as libraries, frameworks, or other components that the plan relies on.]

- **DEP-001**: Dependency 1
- **DEP-002**: Dependency 2

## 5. Files

[List the files that will be affected by the feature or refactoring task.]

- **FILE-001**: Description of file 1
- **FILE-002**: Description of file 2

## 6. Testing

[List the tests that need to be implemented to verify the feature or refactoring task. This section defines what tests must exist — §7 Evals defines how to run them and what output proves they pass.]

- **TEST-001**: Description of test 1
- **TEST-002**: Description of test 2

## 7. Evals

[Consolidated evaluation criteria across all phases. This section is the single source of truth for proving the implementation is correct and complete. Fill in the "Actual" column during or after execution.]

### 7.1 Metrics

| Eval ID | Phase | Metric | Target | Actual | Status |
|---------|-------|--------|--------|--------|--------|
| EVAL-001 | Phase 1 | [Metric description] | [Target value] | | ⬜ |
| EVAL-002 | Phase 1 | [Metric description] | [Target value] | | ⬜ |
| EVAL-003 | Phase 2 | [Metric description] | [Target value] | | ⬜ |
| EVAL-004 | Phase 2 | [Metric description] | [Target value] | | ⬜ |

> Status legend: ⬜ Not run · ✅ Passed · ❌ Failed

### 7.2 Expected Eval Outputs

[For each eval, the exact command to execute and the exact output that must be observed. These outputs serve as the definitive proof of a correct implementation.]

**EVAL-001 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed]
```

**EVAL-002 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed]
```

**EVAL-003 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed]
```

**EVAL-004 — [Metric name]**
```
# Run
[exact command]

# Expected output
[exact terminal/log output that must be observed]
```

## 8. Risks & Assumptions

[List any risks or assumptions related to the implementation of the plan.]

- **RISK-001**: Risk 1
- **ASSUMPTION-001**: Assumption 1

## 9. Related Specifications / Further Reading

[Link to related spec 1]
[Link to relevant external documentation]
```
