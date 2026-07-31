---
name: markitdown
description: Convert PDFs, Office files, images, HTML, EPUB/ZIP/audio, or other docs to LLM-friendly Markdown with MarkItDown; include install/CLI/API/batch/plugin help. Use when converting local files or documents. Not for fetching web pages by URL (use fetch-website-to-markdown).
compatibility:
  tools: bash, read, write, edit
  dependencies: Python 3.10+, markitdown
---

# MarkItDown

Use MarkItDown when the task is about converting existing files into structured Markdown for LLM or text-analysis workflows. Prefer it over ad hoc parsing when the source is a document format MarkItDown already supports.

MarkItDown is a lightweight converter, not a pixel-perfect document renderer. Strong default when the user wants headings, lists, tables, links, and readable structure preserved in Markdown. Weaker fit when the user needs layout-faithful or visual-exact reproduction.

## When to use

- Converting PDF, PowerPoint, Word, Excel, images, audio, HTML, CSV/JSON/XML, ZIP archives, YouTube URLs, or EPUBs to Markdown.
- Preparing documents for LLM/RAG/search/summarization pipelines.
- User wants a one-off CLI conversion, a reusable Python conversion script, or batch conversion of a directory.

If a format may depend on optional extras, verify the needed dependency and install only what's necessary unless the user explicitly asks for `markitdown[all]`.

## Core workflow

1. Identify the source input, desired output path, and whether to actually run the conversion or just explain it.
2. Check whether `markitdown` is already available before suggesting installation.
3. Match the install to the task: broad coverage `pip install 'markitdown[all]'`, or narrower installs like `pip install 'markitdown[pdf,docx,pptx]'`.
4. Prefer the CLI for one-off conversions and simple shell workflows; prefer the Python API for loops, custom automation, app integration, or reusable scripts.
5. Save the Markdown to a sensible output file, usually next to the source, unless the user asked for another location.
6. Briefly sanity-check the result and call out likely limitations, especially for OCR-heavy, scanned, or layout-sensitive documents.

## Response style

- Be explicit about the exact command or script used.
- Save outputs to clear file paths; mention any install step separately from the conversion step.
- When the user only wants guidance, give the shortest working command first, then add only the relevant variants: install, stdin, batch, Python API, plugins, or troubleshooting.

## Full reference

Read `references/markitdown-cheatsheet.md` for: full install commands (incl. venv/uv setup), all CLI flags and commands (stdin, plugins, Azure Document Intelligence), Python API snippets (minimal, write-to-disk, plugins, Azure, LLM image descriptions), batch conversion patterns (shell + Python), troubleshooting steps, and the default decision tree. Read it before running or explaining any command/option you're not fully sure of.
