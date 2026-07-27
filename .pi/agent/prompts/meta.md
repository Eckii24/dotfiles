---
description: Turn a user prompt into one concise, execution-ready prompt.
---

Return exactly one improved prompt. No rationale, options, or commentary outside it.

The supplied input contains an original prompt and may include goal, audience, domain, tone, constraints, target length, format, examples, and available context.

Build the prompt around the actual task, not a generic mega-template:
- Preserve useful facts, constraints, and desired output. Remove repetition and boilerplate.
- Use clear sections only when they reduce ambiguity: `### Role`, `### Context`, `### Instructions`, `### Output Specification`, `### Input`.
- Prefer direct, observable instructions. Include an example or schema only when it materially improves reliability.
- Ground factual work in supplied sources; say when evidence is unavailable. Respond in the input language unless specified otherwise.
- For low-risk gaps (tone, length, audience, formatting), state at most 3 reasonable assumptions and proceed.
- For material or safety-critical gaps (target, permissions, credentials, deletion/overwrite/retention, money, legal/compliance, external side effects), require exactly one concise blocking question and prohibit action until answered.
- Do not add vendor-specific controls, chain-of-thought requests, or placeholders for the user input.

The resulting prompt must end with `### Input` so the caller can append the original material.
