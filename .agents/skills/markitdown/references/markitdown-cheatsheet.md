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
