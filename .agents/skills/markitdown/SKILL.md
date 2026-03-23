---
name: markitdown
description: Use MarkItDown to convert files into LLM-friendly Markdown. Reach for this skill whenever the user wants to use `markitdown`, convert PDFs, Word docs, PowerPoint decks, Excel files, images, HTML, EPUBs, ZIPs, audio, or similar inputs into Markdown, or asks for an install command, CLI usage, Python API example, batch conversion, plugin setup, or troubleshooting for MarkItDown. Also use it when the user wants document content prepared for RAG, search, summarization, or other text-analysis workflows and MarkItDown is a good fit, even if they do not explicitly mention the library by name.
compatibility:
  tools: bash, read, write, edit
  dependencies: Python 3.10+, markitdown
---

# MarkItDown

Use MarkItDown when the task is about converting existing files into structured Markdown for LLM or text-analysis workflows. Prefer it over ad hoc parsing when the source is a document format that MarkItDown already supports.

MarkItDown is a lightweight converter, not a pixel-perfect document renderer. It is a strong default when the user wants headings, lists, tables, links, and readable structure preserved in Markdown. It is a weaker fit when the user wants layout-faithful reproduction or visual formatting that must match the original exactly.

## Supported inputs

MarkItDown currently supports common conversions including:

- PDF
- PowerPoint
- Word
- Excel
- Images
- Audio
- HTML
- Text-based formats such as CSV, JSON, and XML
- ZIP archives
- YouTube URLs
- EPUBs

If the user asks about a format that might depend on optional extras, verify the needed dependency and install only what is necessary unless they explicitly ask for `markitdown[all]`.

## Default workflow

1. Identify the source input, desired output path, and whether the user wants you to actually run the conversion or just explain it.
2. Check whether `markitdown` is already available before suggesting installation.
3. Match the install to the task:
   - broad coverage: `pip install 'markitdown[all]'`
   - narrower installs: e.g. `pip install 'markitdown[pdf,docx,pptx]'`
4. Prefer the CLI for one-off conversions and simple shell workflows.
5. Prefer the Python API for loops, custom automation, app integration, or when the user wants a reusable script.
6. Save the Markdown to a sensible output file, usually next to the source file unless the user asked for another location.
7. Briefly sanity-check the result and call out likely limitations, especially for OCR-heavy, scanned, or layout-sensitive documents.

## Installation guidance

Start with a virtual environment unless the user clearly wants a global install.

Example:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install 'markitdown[all]'
markitdown --version
```

If the user uses `uv`, prefer:

```bash
uv venv --python=3.12 .venv
source .venv/bin/activate
uv pip install 'markitdown[all]'
```

Ask before installing packages if the environment might be shared or managed.

## CLI usage

Use the CLI for straightforward conversions.

### Basic conversion

```bash
markitdown input.pdf > output.md
```

or:

```bash
markitdown input.pdf -o output.md
```

### Reading from stdin

MarkItDown can read binary data from stdin. When the file type is ambiguous, provide an extension hint.

```bash
cat input.pdf | markitdown -x pdf > output.md
```

Useful hints:

- `-x`, `--extension` for file extension hints
- `-m`, `--mime-type` for MIME type hints
- `-c`, `--charset` for text encodings
- `--keep-data-uris` when the user explicitly wants embedded data URIs preserved instead of truncated

### Plugins

Plugins are disabled by default.

List installed plugins:

```bash
markitdown --list-plugins
```

Enable them for a run:

```bash
markitdown --use-plugins input.pdf -o output.md
```

Only turn plugins on when they are relevant and installed.

### Azure Document Intelligence

Use this only when the user specifically wants Azure Document Intelligence or needs a cloud-based extraction path:

```bash
markitdown input.pdf -d -e "<document_intelligence_endpoint>" -o output.md
```

Do not assume this is configured; ask for the endpoint if needed.

## Python API usage

Use Python when the user wants scripts, batch conversion, or integration into a larger pipeline.

### Minimal example

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=False)
result = md.convert("report.pdf")
print(result.markdown)
```

`result.text_content` still exists as a soft-deprecated alias, but prefer `result.markdown` in new code.

### With plugins enabled

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=True)
result = md.convert("slides.pptx")
print(result.markdown)
```

### With Azure Document Intelligence

```python
from markitdown import MarkItDown

md = MarkItDown(docintel_endpoint="<document_intelligence_endpoint>")
result = md.convert("scan.pdf")
print(result.markdown)
```

### With an LLM client for image descriptions

```python
from markitdown import MarkItDown
from openai import OpenAI

client = OpenAI()
md = MarkItDown(llm_client=client, llm_model="gpt-4o")
result = md.convert("image.jpg")
print(result.markdown)
```

Use this path when the task specifically needs image understanding support and the required client is available.

## Batch conversion pattern

For a directory of files, prefer a small script or shell loop instead of repeating one-off commands.

Shell example:

```bash
for f in docs/*.pdf; do
  markitdown "$f" -o "${f%.pdf}.md"
done
```

Python example:

```python
from pathlib import Path
from markitdown import MarkItDown

md = MarkItDown()
for path in Path("docs").glob("*.docx"):
    result = md.convert(str(path))
    path.with_suffix(".md").write_text(result.markdown, encoding="utf-8")
```

## Troubleshooting

If conversion fails:

1. Check whether the relevant optional dependency is installed.
2. Confirm the file is actually the format it claims to be.
3. If reading from stdin, add `-x` and possibly `-m`.
4. For scanned PDFs or image-heavy documents, explain that default offline extraction may be limited and suggest Azure Document Intelligence or an OCR-capable plugin when appropriate.
5. For plugin-based behavior, confirm the plugin is installed and that `--use-plugins` or `enable_plugins=True` is set.

## Response style

When doing the work for the user:

- Be explicit about the exact command or script you used.
- Save outputs to clear file paths.
- Mention any install step separately from the conversion step.
- Keep the explanation concise unless the user asked for a deeper walkthrough.

When the user only wants guidance:

- Give the shortest working command first.
- Then add only the relevant variants: install, stdin, batch, Python API, plugins, or troubleshooting.

## Read more when needed

If you need a compact command reference or troubleshooting reminders, read `references/markitdown-cheatsheet.md`.
