---
name: fetch-website-to-markdown
description: Use when a public webpage must become a durable local Markdown source. Saves one source-preserving file per URL; not for quick fact lookup, summaries, or local-file conversion.
compatibility:
  tools: bash, read, write
---

# Fetch Website to Markdown

Use this skill to fetch one or more public webpages and save them as proper Markdown files.

## What this skill should do

- Fetch the page content with a browser-like user agent.
- Convert the main readable article/page body to Markdown.
- Save a Markdown file that includes:
  - the page title as `# H1`
  - the source URL
  - the retrieval date
- Preserve links and formatting as well as possible.
- Keep one Markdown file per URL unless the user explicitly asks for a combined file.

## Before you start

Capture these details if the user did not already provide them:

1. The URL or list of URLs.
2. The output path or output directory.
3. Whether they want:
   - one file per URL, or
   - one combined Markdown file.
4. Any filename preferences.

Use these defaults if the user does not specify them:

- Save one `.md` file per URL.
- Put the source URL near the top of the file.
- Include the retrieval date.
- Derive the filename from the page title or URL slug.

## Workflow

1. Normalize the URL.
   - Decode HTML-escaped query parameters such as `&amp;`.
   - Keep the full canonical URL the user gave you unless they ask you to strip tracking parameters.

2. Choose an output location.
   - If the user gave an explicit file path, use it.
   - If they gave a directory, create one Markdown file per URL inside that directory.
   - If they gave nothing, ask once or use a sensible local directory only if the user clearly does not care.

3. Use the bundled script for the conversion. Replace `<SKILL_DIR>` with the directory containing this `SKILL.md`.

```bash
python3 <SKILL_DIR>/scripts/fetch_to_markdown.py \
  --url "<URL>" \
  --output "<OUTPUT_FILE>.md"
```

   - For a directory-based workflow, use `--out-dir` instead of `--output`.
   - For multiple URLs, call the script once per URL.

4. Review the generated Markdown.
   - Confirm the file starts with the title and metadata block.
   - Check that headers, lists, links, and code fences look reasonable.
   - If the output is obviously broken, rerun with a different extractor:

```bash
python3 <SKILL_DIR>/scripts/fetch_to_markdown.py \
  --url "<URL>" \
  --output "<OUTPUT_FILE>.md" \
  --extractor readability
```

5. Summarize clearly for the user.
   - Tell them which files were written.
   - Mention any extraction limitations, such as paywalls, JS-heavy pages, or missing images.

## Output format

Unless the user asks for a different structure, the Markdown file should look like this:

```md
# Page Title

- Source URL: https://example.com/page
- Retrieved: 2026-03-18

---

[Converted markdown body]
```

## When quality is imperfect

Some sites convert poorly (JS-heavy, paywalled, auth-gated, nav-chrome-heavy). Do the best conversion you can and say explicitly what's incomplete; don't claim a perfect extraction. Full edge-case guidance, batch-mode conventions, and worked examples: `references/edge-cases-and-examples.md`.

## Notes for the model using this skill

- Prefer the bundled script over ad-hoc one-off conversion logic.
- Be explicit about where files were saved.
- Include the source URL in the Markdown unless the user explicitly asks you not to.
- If the user asks for "proper markdown," do a quick sanity check after conversion instead of blindly trusting the first result.
