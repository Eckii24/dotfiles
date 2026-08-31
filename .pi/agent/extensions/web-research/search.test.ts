import { expect, test } from "bun:test";

import { searchDuckDuckGo } from "./search.ts";
import type { Requester } from "./types.ts";

const html = `
  <div class="result">
    <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%23section">First</a>
    <span class="result__snippet">First snippet</span>
  </div>
  <a class="result__a" href="https://example.com/a">Duplicate</a>
  <a class="result__a" href="javascript:alert(1)">Unsafe</a>
  <a class="result__a" href="https://example.org/b">Second</a>
`;

const request: Requester = async (_url, _address, signal) => {
  expect(signal).toBeInstanceOf(AbortSignal);
  return { statusCode: 200, headers: { "content-type": "text/html" }, body: new TextEncoder().encode(html) };
};

test("search unwraps, normalizes, filters, and deduplicates result URLs", async () => {
  const result = await searchDuckDuckGo("web research", 5, request, new AbortController().signal);
  expect(result).toEqual({
    query: "web research",
    provider: "DuckDuckGo",
    results: [
      { title: "First", url: "https://example.com/a", snippet: "First snippet" },
      { title: "Second", url: "https://example.org/b", snippet: "" },
    ],
  });
});

test("search retries a transient provider response once", async () => {
  let attempts = 0;
  const retryingRequest: Requester = async () => {
    attempts += 1;
    return attempts === 1
      ? { statusCode: 202, headers: {}, body: new Uint8Array() }
      : { statusCode: 200, headers: { "content-type": "text/html" }, body: new TextEncoder().encode(html) };
  };
  const result = await searchDuckDuckGo("retry", 1, retryingRequest);
  expect(attempts).toBe(2);
  expect(result.results).toHaveLength(1);
});

test("search falls back to Bing RSS when DuckDuckGo stays unavailable", async () => {
  const fallbackRequest: Requester = async (url) => {
    if (url.hostname === "html.duckduckgo.com") return { statusCode: 202, headers: {}, body: new Uint8Array() };
    return { statusCode: 200, headers: { "content-type": "text/xml" }, body: new TextEncoder().encode("<rss><channel><item><title>Bing result</title><link>https://example.net/path#part</link><description>&lt;b&gt;Bing&lt;/b&gt; snippet</description></item></channel></rss>") };
  };
  const result = await searchDuckDuckGo("fallback", 1, fallbackRequest);
  expect(result).toEqual({ query: "fallback", provider: "Bing RSS", results: [{ title: "Bing result", url: "https://example.net/path", snippet: "Bing snippet" }] });
});