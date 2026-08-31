# Web Research Extension

## Contract

Provides two bounded, public-network capabilities:

- `web_search`: DuckDuckGo discovery results, then Bing RSS fallback (each gets one short retry for transient responses).
- `web_fetch`: readable text/HTML/JSON/XML from up to five public HTTP(S) URLs.

All returned page text and search snippets are untrusted data. The fetcher validates every redirect, pins DNS resolution for the request, rejects local/private targets and non-standard ports, limits redirects/downloads/concurrency, and returns the canonical `finalUrl` for attribution.

## Intended use

`web_search` finds candidate sources. `web_fetch` supplies the actual page body. A research claim must cite the fetched result's `finalUrl`; a search snippet is discovery evidence only. Use several independent, primary sources when the decision warrants it.

The `scout` profile has these tools for one bounded external uncertainty. It is deliberately not a general research writer.

## Boundary: capability, not a skill replacement

This extension replaces generic *retrieval mechanics* only. It does **not** replace procedural skills that define a research deliverable: source selection and independence, claim/evidence mapping, domain-specific methods, citation rendering/verification, or decision synthesis.

It is therefore not suitable as a wholesale replacement for existing skills. Retire a skill only when its sole value is “search and fetch public pages”; keep skills that encode domain method or output/verification rules.

## Deliberate non-goals

- JavaScript-rendered or authenticated pages
- PDFs, Office documents, images, audio, video, and OCR
- Private/intranet targets or arbitrary ports
- Scholarly indexes, crawling, or autonomous multi-source synthesis

Those need an explicitly selected, separately tested capability or skill—not silent expansion of this fetcher.