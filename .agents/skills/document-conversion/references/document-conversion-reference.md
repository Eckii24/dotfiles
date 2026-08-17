# Document conversion reference

Read this reference before using an uncommon Docling mode, its Python API, or the MarkItDown fallback. The normal `docling convert input --to md --output out` path is complete in `SKILL.md`.

## Installed baseline

- Installed as persistent `uv tool`: `docling` v2.119.0.
- Installation contract on this Linux host: `uv tool install --torch-backend cpu docling`.
- CPU Torch avoids unnecessary NVIDIA/CUDA packages. It does not mean Docling needs no large dependencies: the tool environment includes Torch and the first PDF/image processing can fetch Docling model artifacts.
- Upgrade deliberately: `uv tool upgrade docling --torch-backend cpu`, then verify `docling --version` and `docling convert --help`.
- Remove only on explicit request: `uv tool uninstall docling`.

## Supported formats and output

Current Docling supports input including PDF; DOCX/XLSX/PPTX; legacy DOC/XLS/PPT (LibreOffice required); ODT/ODS/ODP; EPUB; Markdown; AsciiDoc; LaTeX; HTML/XHTML; CSV; PNG/JPEG/TIFF/BMP/WEBP; audio/video with the `asr` extra; WebVTT; BoxNote; `.eml`/`.msg`; and schema-specific XML/JSON formats.

Useful outputs: Markdown (`md`), JSON, YAML, HTML, `html_split_page`, plain text, Doctags, WebVTT, DocLang (`doclang`), DocLang archive (`dclx`), and chunked JSONL (`chunks`).

Use `docling convert --help` as the local source of truth after an upgrade.

## PDF options

```bash
# Default: standard PDF pipeline, OCR and tables enabled
docling convert report.pdf --to md --output out

# Explicit CPU/threads for a constrained run
docling convert report.pdf --device cpu --num-threads 2 --to md --output out

# OCR full page when the embedded PDF text is unusable
docling convert scan.pdf --ocr-mode full_page --to md --output out

# Visual-language-model pipeline: deliberate escalation only
docling convert difficult.pdf --pipeline vlm --vlm-model granite_docling --to md --output out

# Extract tables with speed/fidelity trade-off
docling convert report.pdf --tables --table-mode accurate --to md --output out
```

`--image-export-mode placeholder|embedded|referenced` applies to image-capable outputs. `referenced` emits PNG files plus links in Markdown. It does **not** promise original page PNGs. `--show-layout` adds bounding boxes to visualizations and is debugging only.

## Python API

Use the Python API only when a loop, custom pipeline options, or an application integration requires it. Keep the dependency isolated in a project environment; do not import from the global `uv tool` environment by path.

```python
from pathlib import Path
from docling.document_converter import DocumentConverter

source = Path("input.pdf")
result = DocumentConverter().convert(source)
source.with_suffix(".md").write_text(result.document.export_to_markdown(), encoding="utf-8")
```

For `generate_page_images=True`, use the current Docling API documentation and pin/test the project dependency. That capability is not exposed as a stable generic CLI `--generate-page-images` option.

## MarkItDown fallback

Use only when its unique capability is material:

| Need | Isolated command |
|---|---|
| ZIP recursion / general broad lightweight conversion | `uvx --from 'markitdown[all]' markitdown input.zip -o out.md` |
| YouTube URL transcription | `uvx --from 'markitdown[youtube-transcription]' markitdown 'https://…' -o out.md` |
| Azure Document Intelligence or Content Understanding | install/configure only with explicit user endpoint and cost approval |

MarkItDown's `convert()` API can fetch URLs and operates with caller privileges. For untrusted environments, use its narrow local-file/stream API rather than permissive generic `convert()`.

## Fidelity decision table

| Requirement | Recommended path |
|---|---|
| Semantic document Markdown | Docling |
| Scanned PDF text/tables/layout | Docling, then bounded OCR/pipeline escalation |
| RAG JSONL chunks | Docling `--to chunks` |
| Images recognized inside a document | Docling `--image-export-mode referenced` |
| Every PDF page as PNG | Poppler `pdftocairo`/`pdftoppm` in parallel with Docling |
| Edit/create PDF | PDF-specific tool, not a converter |
| Public web article | `fetch-website-to-markdown` |
| ZIP/YouTube/Azure CU | MarkItDown fallback |
