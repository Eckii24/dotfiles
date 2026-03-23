# Presenterm Reference

A concise reference for creating and running Presenterm slide decks.

## Official sources

- Official documentation: https://mfontanini.github.io/presenterm/print.html
- GitHub repository: https://github.com/mfontanini/presenterm
- Example presentations: https://github.com/mfontanini/presenterm/tree/master/examples

## Most useful doc sections

- Quick start: https://mfontanini.github.io/presenterm/print.html#quick-start
- Presentations and slide structure: https://mfontanini.github.io/presenterm/print.html#presentations
- Comment commands: https://mfontanini.github.io/presenterm/print.html#comment-commands
- Layouts / columns: https://mfontanini.github.io/presenterm/print.html#layouts
- Images: https://mfontanini.github.io/presenterm/print.html#images
- Code highlighting: https://mfontanini.github.io/presenterm/print.html#code-highlighting
- Mermaid: https://mfontanini.github.io/presenterm/print.html#mermaid
- Themes: https://mfontanini.github.io/presenterm/print.html#themes
- Exporting: https://mfontanini.github.io/presenterm/print.html#exporting-presentations
- Speaker notes: https://mfontanini.github.io/presenterm/print.html#speaker-notes
- Configuration: https://mfontanini.github.io/presenterm/print.html#configuration

## Installation

### macOS

```bash
brew install presenterm
```

### Cargo

```bash
cargo binstall presenterm
# or
cargo install --locked presenterm
```

## Core usage

### Run in authoring mode with hot reload

```bash
presenterm deck.md
```

By default, Presenterm reloads the presentation when the file changes. This is useful while drafting.

### Run in presentation mode

```bash
presenterm --present deck.md
```

### Export HTML

```bash
presenterm --export-html deck.md --output deck.html
```

HTML export is self-contained and does not require extra dependencies.

### Export PDF

```bash
presenterm --export-pdf deck.md --output deck.pdf
```

PDF export requires `weasyprint`. A convenient variant is:

```bash
uv run --with weasyprint presenterm --export-pdf deck.md --output deck.pdf
```

## Presentation file structure

A Presenterm deck is a single Markdown file. Slides are separated with:

```html
<!-- end_slide -->
```

Minimal example:

```markdown
---
title: Demo Deck
author: Matthias
theme:
  name: dark
---

Intro
=====

- Goal
- Scope
- Outcome

<!-- end_slide -->

Deep Dive
=========

- Point 1
- Point 2
```

## Important syntax

### Intro slide via front matter

```yaml
---
title: "My _first_ **presentation**"
sub_title: Optional subtitle
author: Myself
---
```

Use front matter only when you actually want an introduction slide.

### Slide titles

Setext headers are treated like slide titles:

```markdown
Agenda
======
```

### Pauses

```html
<!-- pause -->
```

### Incremental bullet lists

```html
<!-- incremental_lists: true -->
```

### Column layout

```html
<!-- column_layout: [2, 1] -->
<!-- column: 0 -->
Left side
<!-- column: 1 -->
Right side
<!-- reset_layout -->
```

### Include another markdown file

```html
<!-- include: partial.md -->
```

### Speaker notes

Single line:

```html
<!-- speaker_note: key message for this slide -->
```

Multiline:

```html
<!--
speaker_note: |
  first reminder
  second reminder
-->
```

### User comments that are ignored during rendering

```html
<!-- // TODO tighten this story -->
<!-- comment: source from internal architecture review -->
```

## Images

- Images must be local; remote images are not supported.
- Paths are relative to the presentation file.
- Resize with attributes like:

```markdown
![image:width:50%](image.png)
```

- If images do not render correctly inside tmux, passthrough support may need to be enabled.

## Mermaid

Render Mermaid diagrams from fenced code blocks:

````markdown
```mermaid +render
flowchart LR
    A --> B
```
````

Notes:
- Requires `mermaid-cli`
- Rendering can be slower because it spins up a browser internally
- Prefer adjusting Mermaid scale in configuration before overusing per-diagram width changes

## Themes

Choose a built-in theme in front matter:

```yaml
---
theme:
  name: dark
---
```

Or use light/dark variants:

```yaml
---
theme:
  light: light
  dark: dark
---
```

Or point to a custom theme file:

```yaml
---
theme:
  path: /absolute/path/to/theme.yaml
---
```

## Speaker note workflow

Main presenter instance:

```bash
presenterm deck.md --publish-speaker-notes
```

Separate notes instance:

```bash
presenterm deck.md --listen-speaker-notes
```

## Discoverability and diagnostics

List supported comment commands:

```bash
presenterm --list-comment-commands
```

## Best-practice checklist

- Keep one main idea per slide.
- Prefer short bullets over paragraphs.
- Use `<!-- end_slide -->` explicitly for clarity.
- Prefer local assets with stable relative paths.
- Use Presenterm column/layout commands instead of HTML layout hacks.
- Use authoring mode with hot reload while drafting.
- Use `--present` only for actual presenting/rehearsal.
- Use HTML export as the default share format unless PDF is specifically required.
- Mention optional dependencies when using PDF export, Mermaid, or executable snippets.
- Keep diagrams and code blocks simple enough to remain readable in a terminal.

## Advanced features to use carefully

### Executable code blocks

Executable snippets exist, for example:

````markdown
```bash +exec
echo hello world
```
````

This requires explicit enablement (`-x` or config) and should be treated carefully because it can run arbitrary code.

### Code-to-image rendering

Presenterm can also render images emitted by code blocks with `+image`, but only use this when the user actually needs it.

## When to consult the full docs

Open the full docs when you need:

- exact theme schema details
- advanced snippet execution behavior
- configuration file options
- Mermaid and D2 tuning
- export customization
- key binding customization
