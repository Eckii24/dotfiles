---
name: create-architectural-decision-record
description: 'Create an Architectural Decision Record (ADR) document for AI-optimized decision documentation.'
---

# Create Architectural Decision Record

Create an ADR document for `${input:DecisionTitle}` using structured formatting optimized for AI consumption and human readability.

## When to create an ADR

Create an ADR when a decision should outlive the current feature and be easy to discover later, especially when it:
- affects multiple features, teams, or systems
- changes project conventions or architecture boundaries
- includes meaningful tradeoffs that future work must understand
- rejects alternatives that would otherwise be re-proposed repeatedly
- deserves formal visibility beyond `.ai/current-work.md`

For decisions that are still evolving during implementation, keep them in `.ai/current-work.md` first. Use `tracked-work` and `project-memory` to decide when the decision is stable enough to promote into an ADR.

## Inputs

- **Context**: `${input:Context}`
- **Decision**: `${input:Decision}`
- **Alternatives**: `${input:Alternatives}`
- **Stakeholders**: `${input:Stakeholders}`

## Input Validation
If any of the required inputs are not provided or cannot be determined from the conversation history, ask the user to provide the missing information before proceeding with ADR generation.

If `.ai/current-work.md` or related feature artifacts exist, read them before drafting the ADR. Treat them as source material for the original rationale, rejected alternatives, constraints, and consequences instead of inventing that context from memory.

## Integration with `tracked-work` and `project-memory`

If the decision originated in tracked feature work, use `tracked-work` as the source of truth for the feature record and artifact set.

Use `project-memory` to distinguish:
- active feature reasoning that should stay in the feature record
- durable project decisions that should be promoted and preserved broadly

## Requirements

- Use precise, unambiguous language
- Follow standardized ADR format with front matter
- Include both positive and negative consequences
- Document alternatives with rejection rationale
- Preserve the real reasoning from the feature work, not just the final choice
- Structure for machine parsing and human reference
- Use coded bullet points (3-4 letter codes + 3-digit numbers) for multi-item sections

The ADR must be saved in the `/docs/adr/` directory using the naming convention: `adr-NNNN-[title-slug].md`, where NNNN is the next sequential 4-digit number (e.g., `adr-0001-database-selection.md`).

## See also

- `tracked-work` — feature anchor, artifact context, promotion review
- `project-memory` — durable memory and promotion criteria

## Required Documentation Structure

The documentation file must follow the template below, ensuring that all sections are filled out appropriately. The front matter for the markdown should be structured correctly as per the example following:

```md
---
title: "ADR-NNNN: [Decision Title]"
status: "Proposed"
date: "YYYY-MM-DD"
authors: "[Stakeholder Names/Roles]"
tags: ["architecture", "decision"]
supersedes: ""
superseded_by: ""
---

# ADR-NNNN: [Decision Title]

## Status

**Proposed** | Accepted | Rejected | Superseded | Deprecated

## Context

[Problem statement, technical constraints, business requirements, environmental factors, and any important feature-history context requiring this decision.]

## Decision

[Chosen solution with clear rationale for selection.]

## Consequences

### Positive

- **POS-001**: [Beneficial outcomes and advantages]
- **POS-002**: [Performance, maintainability, scalability improvements]
- **POS-003**: [Alignment with architectural principles]

### Negative

- **NEG-001**: [Trade-offs, limitations, drawbacks]
- **NEG-002**: [Technical debt or complexity introduced]
- **NEG-003**: [Risks and future challenges]

## Alternatives Considered

### [Alternative 1 Name]

- **ALT-001**: **Description**: [Brief technical description]
- **ALT-002**: **Rejection Reason**: [Why this option was not selected]

### [Alternative 2 Name]

- **ALT-003**: **Description**: [Brief technical description]
- **ALT-004**: **Rejection Reason**: [Why this option was not selected]

## Implementation Notes

- **IMP-001**: [Key implementation considerations]
- **IMP-002**: [Migration or rollout strategy if applicable]
- **IMP-003**: [Monitoring and success criteria]

## References

- **REF-001**: [Related ADRs]
- **REF-002**: [Feature anchor, specs, or plans that informed this ADR]
- **REF-003**: [External documentation]
- **REF-004**: [Standards or frameworks referenced]
```
