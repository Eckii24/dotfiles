---
name: fetch-website-to-markdown
description: Convert public webpages, articles, docs pages, blog posts, or lists of URLs into clean Markdown files. Use this skill whenever the user asks to download, archive, save, scrape, mirror, or turn a website/page/article/docs page into `.md`, even if they do not explicitly say "markdown." Especially use it when the user wants readable headings, lists, links, or code blocks preserved, or wants one Markdown file per URL with the source URL included.
compatibility:
  tools: bash, write
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

3. Use the bundled script for the conversion.
   - Run:

```bash
python3 /Users/matthias.eck/.agents/skills/fetch-website-to-markdown/scripts/fetch_to_markdown.py \
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
python3 /Users/matthias.eck/.agents/skills/fetch-website-to-markdown/scripts/fetch_to_markdown.py \
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

Some sites are hard to convert cleanly.

If the page is:
- heavily JavaScript-rendered,
- behind authentication,
- paywalled,
- or full of navigation chrome,

then do the best conversion you can and explicitly say what may be incomplete.

Do not pretend the extraction is perfect if it is not.

## Batch mode guidance

When converting multiple URLs:

- Prefer one file per URL.
- Use stable, readable filenames.
- If order matters, prefix files with `01-`, `02-`, `03-`, etc.
- Keep the source URL inside each file, not only in your final summary.

## Examples

**Example 1**  
Input: “Download this article and save it as markdown in `docs/`: https://martinfowler.com/articles/gen-ai-patterns/”  
Output: A file like `docs/emerging-patterns-in-building-genai-products.md`

**Example 2**  
Input: “Fetch these 4 docs pages and save one markdown file per URL.”  
Output: Four `.md` files, each with title, source URL, retrieval date, and converted content.

**Example 3**  
Input: “Turn this blog post into markdown and name it `oil-water-moment.md`.”  
Output: Exactly that file name, with the converted article body inside.

## Notes for the model using this skill

- Prefer the bundled script over ad-hoc one-off conversion logic.
- Be explicit about where files were saved.
- Include the source URL in the Markdown unless the user explicitly asks you not to.
- If the user asks for "proper markdown," do a quick sanity check after conversion instead of blindly trusting the first result.
