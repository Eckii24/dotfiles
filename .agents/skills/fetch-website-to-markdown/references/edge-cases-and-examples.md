# Edge Cases, Batch Mode, and Examples

Reference material for `fetch-website-to-markdown/SKILL.md`. Read when handling multiple URLs, a page that converts poorly, or when you want worked examples.

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
Input: "Download this article and save it as markdown in `docs/`: https://martinfowler.com/articles/gen-ai-patterns/"
Output: A file like `docs/emerging-patterns-in-building-genai-products.md`

**Example 2**
Input: "Fetch these 4 docs pages and save one markdown file per URL."
Output: Four `.md` files, each with title, source URL, retrieval date, and converted content.

**Example 3**
Input: "Turn this blog post into markdown and name it `oil-water-moment.md`."
Output: Exactly that file name, with the converted article body inside.
