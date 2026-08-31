import { DOMParser, parseHTML } from "linkedom";

import { requestPinned } from "./fetch.ts";
import { validatePublicUrl } from "./ssrf.ts";
import type { Requester, SearchResponse, SearchResult } from "./types.ts";

export async function searchDuckDuckGo(
  query: string,
  maxResults = 5,
  requester: Requester = requestPinned,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  if (typeof query !== "string" || !query.trim()) throw new Error("query must be a non-empty string.");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new Error("maxResults must be an integer between 1 and 10.");
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const approved = await validatePublicUrl(url.href);
  const response = await requestSearch(approved.url, approved.addresses[0]!, requester, signal);
  if (response.statusCode === 200) return parseDuckDuckGo(query, maxResults, response.body, approved.url);

  const fallback = await searchBingRss(query, maxResults, requester, signal);
  if (fallback) return fallback;
  throw new Error(`DuckDuckGo returned HTTP ${response.statusCode}; Bing RSS fallback was unavailable.`);
}

function parseDuckDuckGo(query: string, maxResults: number, body: Uint8Array, baseUrl: URL): SearchResponse {
  const { document } = parseHTML(new TextDecoder().decode(body));
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const anchor of document.querySelectorAll("a.result__a")) {
    if (results.length >= maxResults) break;
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const row = anchor.closest(".result");
    const snippet = normalized(row?.querySelector(".result__snippet")?.textContent ?? "");
    try {
      const target = new URL(href, baseUrl);
      const destination = publicHttpUrl(target.searchParams.get("uddg") ?? target.href, baseUrl);
      if (!destination || seen.has(destination)) continue;
      seen.add(destination);
      results.push({ title: normalized(anchor.textContent), url: destination, snippet });
    } catch { /* Skip malformed search result. */ }
  }
  return { query, provider: "DuckDuckGo", results };
}

async function searchBingRss(query: string, maxResults: number, requester: Requester, signal?: AbortSignal): Promise<SearchResponse | undefined> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);
  const approved = await validatePublicUrl(url.href);
  const response = await requestSearch(approved.url, approved.addresses[0]!, requester, signal);
  if (response.statusCode !== 200) return undefined;

  const document = new DOMParser().parseFromString(new TextDecoder().decode(response.body), "text/xml");
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const item of document.querySelectorAll("item")) {
    if (results.length >= maxResults) break;
    const destination = publicHttpUrl(item.querySelector("link")?.textContent ?? "");
    if (!destination || seen.has(destination)) continue;
    seen.add(destination);
    const description = item.querySelector("description")?.textContent ?? "";
    results.push({
      title: normalized(item.querySelector("title")?.textContent ?? destination),
      url: destination,
      snippet: normalized(stripMarkup(description)),
    });
  }
  return { query, provider: "Bing RSS", results };
}

function publicHttpUrl(raw: string, baseUrl?: URL): string | undefined {
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

async function requestSearch(url: URL, address: string, requester: Requester, signal?: AbortSignal) {
  let response = await requester(url, address, signal);
  if (!isTransientSearchStatus(response.statusCode)) return response;
  await waitBeforeRetry(signal);
  response = await requester(url, address, signal);
  return response;
}

function isTransientSearchStatus(status: number): boolean { return status === 202 || status === 429 || status >= 500; }

function waitBeforeRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error("Search aborted."));
    const timer = setTimeout(resolve, 250);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error("Search aborted.")); }, { once: true });
  });
}

function normalized(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function stripMarkup(value: string): string { return value.replace(/<[^>]*>/g, " "); }
