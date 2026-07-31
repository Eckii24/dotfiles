---
name: presenterm-presentation
description: Create/review/update Presenterm or Markdown slide decks, talk outlines, speaker notes, themes, exports, and presentation flow/readability. Use when authoring or reviewing a slide deck or talk; not for prose documents or non-slide markdown.
compatibility:
  tools: read, write, bash
  dependencies:
    - presenterm
    - weasyprint (optional, for PDF export)
    - mermaid-cli (optional, for Mermaid rendering)
---

# Presenterm Presentation

Use this skill to create or modify slide decks for [Presenterm](https://mfontanini.github.io/presenterm/print.html), a terminal-based presentation tool that uses Markdown as the source format.

## When to use

- User asks to create, review, or update a Presenterm or Markdown-based slide deck.
- User asks for "slides" in a terminal/markdown context, even without naming Presenterm.
- Task touches themes, Mermaid diagrams, speaker notes, exports (HTML/PDF), layouts, alignment, or comment commands.
- User wants an existing deck simplified, restructured, or made presentation-ready.

## Default house style

Unless the user explicitly asks for something else, apply these defaults to every new or refactored deck:

1. Front matter always has `title`, `sub_title`, `author`, and `options.list_item_newlines: 2`.
2. No duplicate title slide — the title slide comes from the front matter.
3. Slide titles use Setext `---` headings, not `======`.
4. `<!-- alignment: center -->` on every slide unless a different layout is needed.
5. `<!-- jump_to_middle -->` only on divider/transition/sparse slides (at most 1-3 short lines).
6. Keep slides very clean and very small; prefer more slides over denser ones.
7. Default to speaker notes for live talks so slides stay light.
8. Treat these as defaults, not laws — adapt deliberately when clarity, story flow, or audience needs call for it.

If `title`/`sub_title`/`author` are missing, derive concise defaults from context and state that briefly.

## What this skill should produce

- A primary deck file (`deck.md` or `<topic>.md`).
- Optional supporting files only when needed: theme YAML, local images/assets, included Markdown partials.
- Clear run/export commands for the user.
- References to further documentation.

## Before you start

Capture what the user already gave, filling gaps with sensible stated defaults: presentation goal/audience, delivery mode (live talk, workshop, demo, recorded, async readout), expected length, output path/filename, front-matter values, desired deliverable (source only / runnable / exported HTML-PDF / speaker notes / custom theme), whether demos or discussion prompts fit, and whether assets already exist locally.

## Core workflow

1. Define the deliverable and presentation mode (live talk, workshop, demo-heavy, async); create a single Markdown deck first, add extra files only if needed.
2. Shape a light narrative arc before writing slides: hook, orientation, 2-4 main sections, optional demo/interaction, takeaways, close/Q&A.
3. Structure the deck with house-style front matter, one Markdown file as source of truth, slides separated by `<!-- end_slide -->`.
4. Apply the default slide pattern: centered alignment, `---` slide titles, `jump_to_middle` only for sparse divider slides, short/sparse bodies.
5. Write for speaking, not reading: one idea per slide, concise bullets/short code/visuals, nuance pushed into speaker notes.
6. Use Presenterm-native comment commands (`pause`, `incremental_lists`, `column_layout`/`column`/`reset_layout`, `speaker_note`) instead of ad-hoc HTML.
7. Add delivery support for live talks: speaker notes by default, `pause`/`incremental_lists` only where genuinely useful, interaction/demos when they help.
8. Make the deck runnable (`presenterm <file>.md` while drafting, `presenterm --present <file>.md` to present).
9. If export is requested: HTML via `presenterm --export-html <file>.md`, PDF via `presenterm --export-pdf <file>.md` (needs `weasyprint`).
10. Run a presentation-quality self-check (clear audience/outcome, one job per slide, explicit transitions/takeaways, readable density, purposeful demos/interaction).
11. End with references to official docs/examples and the deliverables/run/present/export commands.

## Full reference

Read `references/presenterm-reference.md` for: exact Presenterm syntax and comment commands, install commands, the canonical deck template, the full light-presentation-arc guidance, detailed authoring guidance (front matter, slide titles, sizing, alignment, layouts, images, Mermaid orientation, speaker notes, themes, exporting), the full best-practices checklist, the output-format template, and additional model notes. Read it whenever you need exact syntax, are unsure whether a feature is supported, or need a full worked example.
