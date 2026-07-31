# MarkItDown cheatsheet

## When to use it

Use MarkItDown to convert documents and other files into Markdown for LLM, RAG, search, summarization, or other text-processing workflows.

It is usually a better fit than custom parsing when the user wants reasonably structured Markdown rather than layout-faithful rendering.

## Core install commands

Broad install:

```bash
pip install 'markitdown[all]'
```

Targeted install examples:

```bash
pip install 'markitdown[pdf]'
pip install 'markitdown[docx,pptx,xlsx]'
```

Requires Python 3.10+.

## Core CLI commands

Basic conversion:

```bash
markitdown input.pdf -o output.md
```

Stdout:

```bash
markitdown input.docx > output.md
```

stdin with extension hint:

```bash
cat input.pdf | markitdown -x pdf > output.md
```

Plugin discovery:

```bash
markitdown --list-plugins
```

Plugin-enabled conversion:

```bash
markitdown --use-plugins input.pdf -o output.md
```

Azure Document Intelligence:

```bash
markitdown input.pdf -d -e "<document_intelligence_endpoint>" -o output.md
```

## Useful CLI flags

- `-o`, `--output`: write to file instead of stdout
- `-x`, `--extension`: hint file extension when reading from stdin or when detection is weak
- `-m`, `--mime-type`: hint MIME type
- `-c`, `--charset`: hint character encoding
- `-d`, `--use-docintel`: use Azure Document Intelligence
- `-e`, `--endpoint`: Azure Document Intelligence endpoint
- `-p`, `--use-plugins`: enable installed third-party plugins
- `--list-plugins`: list installed plugins
- `--keep-data-uris`: keep embedded data URIs instead of truncating them

## Python API snippets

Minimal:

```python
from markitdown import MarkItDown

md = MarkItDown()
result = md.convert("input.pdf")
print(result.markdown)
```

Write to disk:

```python
from pathlib import Path
from markitdown import MarkItDown

path = Path("input.docx")
md = MarkItDown()
result = md.convert(str(path))
path.with_suffix(".md").write_text(result.markdown, encoding="utf-8")
```

With plugins:

```python
md = MarkItDown(enable_plugins=True)
```

With image-description support:

```python
from markitdown import MarkItDown
from openai import OpenAI

md = MarkItDown(llm_client=OpenAI(), llm_model="gpt-4o")
```

## Notes and caveats

- `result.markdown` is the preferred property. `result.text_content` is a soft-deprecated alias.
- Plugins are disabled by default.
- Optional dependencies matter. A missing extra is a common cause of failure.
- MarkItDown is optimized for useful Markdown structure, not faithful visual reproduction.
- Scanned PDFs and image-heavy files may need Azure Document Intelligence or an OCR-capable plugin.

## Good default decision tree

1. Single file? Use CLI.
2. Many files or integration? Use Python API.
3. Missing support for a file type? Install the right extra.
4. Need OCR or richer extraction? Consider Doc Intelligence or `markitdown-ocr`.
5. Need exact layout preservation? Explain that MarkItDown may not be the right tool.

## Installation (venv setup)

Start with a virtual environment unless the user clearly wants a global install.

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

## Python API: full plugin example

```python
from markitdown import MarkItDown

md = MarkItDown(enable_plugins=True)
result = md.convert("slides.pptx")
print(result.markdown)
```

## Python API: Azure Document Intelligence

```python
from markitdown import MarkItDown

md = MarkItDown(docintel_endpoint="<document_intelligence_endpoint>")
result = md.convert("scan.pdf")
print(result.markdown)
```

## Batch conversion patterns

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

## Troubleshooting steps

If conversion fails:

1. Check whether the relevant optional dependency is installed.
2. Confirm the file is actually the format it claims to be.
3. If reading from stdin, add `-x` and possibly `-m`.
4. For scanned PDFs or image-heavy documents, explain that default offline extraction may be limited and suggest Azure Document Intelligence or an OCR-capable plugin when appropriate.
5. For plugin-based behavior, confirm the plugin is installed and that `--use-plugins` or `enable_plugins=True` is set.
